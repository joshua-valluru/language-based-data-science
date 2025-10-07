import os, json, re
from typing import List, Dict, Any, Optional
from openai import OpenAI

ANSWER_KEYWORDS = [
    "explain", "describe", "what are the columns", "columns", "schema",
    "data dictionary", "missing", "missingness", "null", "na",
    "outlier", "outliers", "anomaly", "anomalies",
    "distribution", "overview", "summarize", "summary", "profile"
]

PLOT_KEYWORDS = ["plot", "chart", "graph", "bar", "line", "scatter"]

# NEW: heuristics to strongly nudge a structured report (HTML card)
REPORT_KEYWORDS = [
    "report", "executive summary", "summary report", "write up", "write-up",
    "overview report", "generate a report", "generate report"
]


class LLMService:
    """
    Produces ONE strict JSON plan:
      {"type":"answer","text":"..."}  # descriptive Q&A using context
      {"type":"sql","sql":"SELECT ... FROM seed ..."}
      {"type":"plot","plot":{"kind":"bar|line|scatter","x":"col","y":"col"}}
      {"type":"report","title":"...","html":"<h2>...</h2> ..."}  # NEW
    """
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def plan(self, message: str, columns: List[Dict], context: Optional[Dict[str, Any]] = None) -> dict:
        # Heuristics to reinforce intent selection (still decided by the model)
        msg_lower = message.lower()
        wants_plot = any(k in msg_lower for k in PLOT_KEYWORDS)
        wants_report = any(k in msg_lower for k in REPORT_KEYWORDS)
        wants_answer = any(k in msg_lower for k in ANSWER_KEYWORDS)

        # precedence: explicit chart > explicit report > generic answer
        # (SQL stays model-driven via instructions)
        schema_lines = "\n".join(f"- {c['name']} ({c['dtype']})" for c in columns)

        plot_hint = "\nThe user explicitly asked for a chart. You MUST return the plot schema." if wants_plot else ""
        report_hint = (
            "\nThe user explicitly asked for a formatted report. You MUST return the report schema with HTML using the allowed structure."
            if wants_report else ""
        )
        answer_hint = (
            "\nThe user is asking to describe/explain the dataset or its quality. "
            "You MUST return the answer schema using the provided CONTEXT."
            if (wants_answer and not wants_report) else ""
        )

        # Small trimmed context to help 'answer'/'report'
        ctx = context or {}
        trimmed = {
            "rows": ctx.get("rows"),
            "preview": (ctx.get("preview") or [])[:8],
            "profile": _trim_profile(ctx.get("profile") or {}),
            "schema": columns[:60],
        }

        system = (
            "You translate ONE analytics request into ONE JSON plan.\n"
            "The current dataset is referenced as table name 'seed'.\n"
            "Available columns:\n"
            f"{schema_lines}\n\n"
            "INTENTS (choose exactly one):\n"
            '1) {"type":"answer","text":"..."}  -> Use when the user asks to explain/describe the data, columns, '
            'missingness, anomalies/outliers, distributions, key categories, or high-level insights using CONTEXT.\n'
            '2) {"type":"sql","sql":"SELECT ... FROM seed ..."} -> Use for specific tabular requests or aggregations.\n'
            '3) {"type":"plot","plot":{"kind":"bar|line|scatter","x":"<col>","y":"<col>"}} -> Use when a chart is clearly requested.\n'
            '4) {"type":"report","title":"...","html":"<h2>...</h2> ..."} -> Use when the user asks for a formatted report/summary.\n'
            "\nREPORT RULES:\n"
            "- Output concise HTML (no <html>/<head>/<body>), only semantic blocks: <h2>, <h3>, <p>, <ul>, <li>, <code>, <pre>.\n"
            "- You may also include metric pills using:\n"
            '  <div class="nr-metrics"> <div class="nr-metric"><div class="lab">Label</div><div class="val">Value</div></div> ... </div>\n'
            "- Use ONLY columns from the list above when referencing fields.\n"
            "- Use the provided CONTEXT for facts; avoid fabricating metrics.\n"
            "\nGENERAL RULES:\n"
            "- Choose exactly one intent.\n"
            "- Prefer 'answer' for descriptive Q&A; 'sql' for tabular; 'plot' for charts; 'report' for formatted summaries.\n"
            "- Output MUST be valid JSON. No prose outside JSON.\n"
            f"{plot_hint}{report_hint}{answer_hint}\n"
        )

        # Few-shots (generic; don't rely on dataset-specific columns)
        examples = [
            # Descriptive
            {"role": "user", "content": "Explain this dataset"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "This dataset includes several fields with limited missingness. Numeric columns show moderate spread; a few potential outliers are present."
            })},
            {"role": "user", "content": "What are the columns and types? Any missing values?"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "Columns and dtypes are as provided. Missing values appear in a handful of fields; categorical columns have a small set of distinct categories."
            })},

            # SQL
            {"role": "user", "content": "total quantity by region"},
            {"role": "assistant", "content": json.dumps({
                "type": "sql",
                "sql": "SELECT region, SUM(quantity) AS total_quantity FROM seed GROUP BY region ORDER BY total_quantity DESC"
            })},

            # Plot
            {"role": "user", "content": "bar chart of quantity by region"},
            {"role": "assistant", "content": json.dumps({
                "type": "plot",
                "plot": {"kind": "bar", "x": "region", "y": "quantity"}
            })},

            # REPORT (NEW)
            {"role": "user", "content": "Give me a short executive summary report of the dataset"},
            {"role": "assistant", "content": json.dumps({
                "type": "report",
                "title": "Dataset Summary",
                "html": (
                    "<h2>Overview</h2>"
                    "<p>This dataset contains rows with several numeric and categorical fields. Missingness is limited and distributions are reasonable.</p>"
                    "<div class=\"nr-metrics\">"
                    "<div class=\"nr-metric\"><div class=\"lab\">Rows</div><div class=\"val\">{rows}</div></div>"
                    "<div class=\"nr-metric\"><div class=\"lab\">Columns</div><div class=\"val\">{cols}</div></div>"
                    "</div>"
                    "<h3>Top Insights</h3>"
                    "<ul><li>Example insight one.</li><li>Example insight two.</li></ul>"
                )
            })}
        ]

        rsp = self.client.chat.completions.create(
            model=self.model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                *examples,
                {"role": "user", "content": f"USER_MESSAGE:\n{message}\n\nCONTEXT:\n{json.dumps(trimmed, ensure_ascii=False, default=str)}"},
            ],
        )

        content = rsp.choices[0].message.content.strip()
        content = re.sub(r"^```json\s*|\s*```$", "", content, flags=re.MULTILINE)

        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            # fallback to an answer so the UX doesn't break
            return {"type": "answer", "text": "Sorry, I couldn't parse a plan for that question."}

        # Minimal validation
        t = data.get("type")
        if t not in {"answer", "sql", "plot", "report"}:
            return {"type": "answer", "text": "I can explain the data, run SQL/plots, or generate a report. Try asking for one of those."}

        if t == "sql":
            sql = (data.get("sql") or "").strip()
            if not sql.lower().startswith("select"):
                raise ValueError("Only SELECT queries are allowed in SQL plan.")

        if t == "plot":
            plot = data.get("plot") or {}
            if plot.get("kind") not in {"bar", "line", "scatter"} or not plot.get("x") or not plot.get("y"):
                raise ValueError("Invalid plot spec. Need kind in {bar,line,scatter}, x, y.")

        if t == "answer":
            if not (data.get("text") or "").strip():
                data["type"] = "answer"
                data["text"] = "Here’s a quick description of the data."

        if t == "report":
            html = (data.get("html") or "").strip()
            # super-basic guard: require some block-level content
            if not html or ("<h2" not in html and "<p" not in html and "<ul" not in html):
                # degrade gracefully to "answer"
                return {"type": "answer", "text": "Here’s a quick description of the data."}
            # Normalize optional title
            if not (data.get("title") or "").strip():
                data["title"] = "Report"

        return data


def _trim_profile(p: Dict[str, Any]) -> Dict[str, Any]:
    if not p:
        return {}
    keep: Dict[str, Any] = {
        "rows": p.get("rows"),
        "columns": p.get("columns", [])[:50],
        "missing": {},
        "numeric": {},
        "categorical": {},
    }
    for k, v in list((p.get("missing") or {}).items())[:50]:
        keep["missing"][k] = v
    for i, (col, stats) in enumerate((p.get("numeric") or {}).items()):
        if i >= 8: break
        keep["numeric"][col] = {k: stats.get(k) for k in ["min","max","mean","std","p25","p50","p75","outlier_count"]}
    for i, (col, info) in enumerate((p.get("categorical") or {}).items()):
        if i >= 8: break
        keep["categorical"][col] = {
            "distinct": info.get("distinct"),
            "top": (info.get("top") or [])[:5]
        }
    return keep
