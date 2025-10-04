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


class LLMService:
    """
    Produces ONE strict JSON plan:
      {"type":"answer","text":"..."}  # for descriptive Q&A using context
      {"type":"sql","sql":"SELECT ... FROM seed ..."}
      {"type":"plot","plot":{"kind":"bar|line|scatter","x":"col","y":"col"}}
    """
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def plan(self, message: str, columns: List[Dict], context: Optional[Dict[str, Any]] = None) -> dict:
        # Heuristics to reinforce intent selection (still decided by the model)
        msg_lower = message.lower()
        wants_plot = any(k in msg_lower for k in PLOT_KEYWORDS)
        wants_answer = any(k in msg_lower for k in ANSWER_KEYWORDS)

        schema_lines = "\n".join(f"- {c['name']} ({c['dtype']})" for c in columns)

        plot_hint = "\nThe user explicitly asked for a chart. You MUST return the plot schema." if wants_plot else ""
        answer_hint = (
            "\nThe user is asking to describe/explain the dataset or its quality. "
            "You MUST return the answer schema using the provided CONTEXT."
            if wants_answer else ""
        )

        # Small trimmed context to help 'answer'
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
            '3) {"type":"plot","plot":{"kind":"bar|line|scatter","x":"<col>","y":"<col>"}} -> Use when a chart is explicitly requested.\n'
            "Rules:\n"
            "- Use ONLY columns from the list above.\n"
            "- Prefer 'answer' for descriptive questions using CONTEXT.\n"
            "- Prefer 'sql' for tabular/aggregation outputs.\n"
            "- Prefer 'plot' when a chart is clearly requested.\n"
            "- Output MUST be valid JSON. No prose outside JSON.\n"
            f"{plot_hint}{answer_hint}\n"
        )

        # Few-shots GO BEFORE the real user message (important!)
        examples = [
            # Descriptive
            {"role": "user", "content": "Explain this dataset"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "This dataset contains rows with columns like region, product, quantity, unit_price, and order_date. Missingness is low; numeric columns show modest spread; a few quantity values may be outliers."
            })},
            {"role": "user", "content": "What are the columns and types? Any missing values?"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "Columns include names and dtypes as provided. Missingness is minimal across most fields; categorical columns have limited distinct values."
            })},
            {"role": "user", "content": "Do you see any anomalies or outliers?"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "Based on numeric quartiles, a handful of records fall beyond Tukey fences; quantities have the most outliers."
            })},

            # SQL
            {"role": "user", "content": "total revenue by region"},
            {"role": "assistant", "content": json.dumps({
                "type": "sql",
                "sql": "SELECT region, SUM(quantity * unit_price) AS revenue FROM seed GROUP BY region ORDER BY revenue DESC"
            })},

            # Plot
            {"role": "user", "content": "bar chart of revenue by region"},
            {"role": "assistant", "content": json.dumps({
                "type": "plot",
                "plot": {"kind": "bar", "x": "region", "y": "revenue"}
            })},
        ]

        # Correct order: system, examples..., REAL user message last
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
        if t not in {"answer", "sql", "plot"}:
            return {"type": "answer", "text": "I can explain the data or run SQL/plots — try asking about columns, outliers, or an aggregation."}
        if t == "sql":
            sql = (data.get("sql") or "").strip()
            if not sql.lower().startswith("select"):
                raise ValueError("Only SELECT queries are allowed in SQL plan.")
        if t == "plot":
            plot = data.get("plot") or {}
            if plot.get("kind") not in {"bar", "line", "scatter"} or not plot.get("x") or not plot.get("y"):
                raise ValueError("Invalid plot spec. Need kind in {bar,line,scatter}, x, y.")
        if t == "answer" and not (data.get("text") or "").strip():
            data["type"] = "answer"
            data["text"] = "Here’s a quick description of the data."
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
