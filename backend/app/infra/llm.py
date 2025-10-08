import os, json, re
from typing import List, Dict, Any, Optional
from openai import OpenAI

# Answer = descriptive/explanatory only (NOT tables/manipulations)
ANSWER_KEYWORDS = [
    "explain", "describe",
    "what are the columns", "columns", "schema",
    "data dictionary", "missing", "missingness", "null", "na",
    "outlier", "outliers", "anomaly", "anomalies",
    "distribution", "overview", "summarize", "profile", "summary statistics"
]

# Chart requests
PLOT_KEYWORDS = ["plot", "chart", "graph", "bar", "line", "scatter"]

# Report (strict): only when they explicitly ask for a report artifact
# NOTE: deliberately excludes "summarize" to avoid accidental report routing.
REPORT_STRICT_PATTERNS = [
    r"\breport\b",
    r"\bexecutive\s+summary\b",
    r"\bsummary\s+report\b",
]

# Table / SQL intents (includes manipulations)
TABLE_KEYWORDS = [
    # explicit table
    "table", "as a table", "tabular", "show me rows", "list rows",
    # projections / column ops
    "select", "project", "keep columns", "only columns", "choose columns",
    "drop column", "drop columns", "remove column", "remove columns", "delete column", "delete columns",
    "hide column", "hide columns", "rename column", "rename columns",
    # row filtering
    "filter", "where", "between", "after", "before", "greater than", "less than",
    # grouping, aggregation, sorting, limits
    "group by", "aggregate", "sum", "avg", "average", "count", "min", "max",
    "order by", "sort by", "top", "bottom", "limit",
    # joins / merges
    "join", "merge",
]


def _matches_any(text: str, needles: List[str]) -> bool:
    tl = text.lower()
    return any(n in tl for n in needles)

def _matches_any_regex(text: str, patterns: List[str]) -> bool:
    tl = text.lower()
    return any(re.search(pat, tl) for pat in patterns)


class LLMService:
    """
    Produces ONE strict JSON plan:
      {"type":"answer","text":"..."}  # descriptive Q&A using context
      {"type":"sql","sql":"SELECT ... FROM seed ..."}
      {"type":"plot","plot":{"kind":"bar|line|scatter","x":"col","y":"col"}}
      {"type":"report","title":"...","html":"<h2>...</h2> ..."}  # formatted HTML card
    """
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def plan(self, message: str, columns: List[Dict], context: Optional[Dict[str, Any]] = None) -> dict:
        msg_lower = message.lower()

        wants_plot   = _matches_any(msg_lower, PLOT_KEYWORDS)
        # Report only if they say "report" (or "executive summary"/"summary report") — NOT "summarize"
        wants_report = _matches_any_regex(msg_lower, REPORT_STRICT_PATTERNS)
        # Table / manipulation ⇒ force SQL
        wants_table  = _matches_any(msg_lower, TABLE_KEYWORDS)
        # “Answer” only for explain/describe/etc (NOT table ops)
        wants_answer = (not wants_plot and not wants_report and not wants_table) and _matches_any(msg_lower, ANSWER_KEYWORDS)

        # Build schema text
        schema_lines = "\n".join(f"- {c['name']} ({c['dtype']})" for c in columns)

        # Context for answer/report
        ctx = context or {}
        trimmed = {
            "rows": ctx.get("rows"),
            "preview": (ctx.get("preview") or [])[:8],
            "profile": _trim_profile(ctx.get("profile") or {}),
            "schema": columns[:60],
        }

        # Strong hints
        plot_hint   = "\nThe user explicitly asked for a chart. You MUST return the plot schema." if wants_plot else ""
        report_hint = (
            "\nThe user explicitly asked for a formal report. You MUST return the report schema with HTML."
            if wants_report else ""
        )
        sql_hint    = (
            "\nThe user explicitly asked for a table or data manipulation. You MUST return the SQL schema (SELECT ... FROM seed ...)."
            if (wants_table and not wants_plot and not wants_report) else ""
        )
        answer_hint = (
            "\nThe user is asking to explain/describe the dataset. You MUST return the answer schema using the CONTEXT."
            if wants_answer else ""
        )

        system = (
            "You translate ONE analytics request into ONE JSON plan.\n"
            "The current dataset is referenced as table name 'seed'.\n"
            "Available columns:\n"
            f"{schema_lines}\n\n"
            "INTENTS (choose exactly one):\n"
            '1) {"type":"sql","sql":"SELECT ... FROM seed ..."} -> Use for ANY table request OR data manipulation:\n'
            "   selecting/dropping/renaming columns, filtering rows, grouping/aggregations, ordering/sorting, limiting, joins.\n"
            '2) {"type":"plot","plot":{"kind":"bar|line|scatter","x":"<col>","y":"<col>"}} -> Use only when a chart is explicitly requested.\n'
            '3) {"type":"report","title":"...","html":"<h2>...</h2> ..."} -> Use only when the user explicitly says “report” or “executive summary”.\n'
            '4) {"type":"answer","text":"..."} -> Use only for explanatory/descriptive questions (explain/describe/what/why), NOT tables.\n'
            "\nSTRICT ROUTING RULES:\n"
            "- If the user asks for a table or any data manipulation, you MUST return type=sql. Do NOT return answer/report/plot.\n"
            "- Only return type=report if they explicitly say “report” or “executive summary”. Never for “summarize”.\n"
            "- Only return type=answer for explain/describe-style questions that do NOT ask for a table or manipulation.\n"
            "- Output MUST be valid JSON. No prose outside JSON.\n"
            f"{plot_hint}{report_hint}{sql_hint}{answer_hint}\n"
        )

        # Few-shots prioritizing SQL for table requests
        examples = [
            # TABLE → SQL
            {"role": "user", "content": "Give this as a table"},
            {"role": "assistant", "content": json.dumps({
                "type": "sql",
                "sql": "SELECT * FROM seed LIMIT 100"
            })},
            {"role": "user", "content": "Drop columns a, b and show the rest as a table"},
            {"role": "assistant", "content": json.dumps({
                "type": "sql",
                "sql": "SELECT * EXCLUDE (a, b) FROM seed"
            })},
            {"role": "user", "content": "Filter rows to order_date after 2024-12-01 and show region, revenue"},
            {"role": "assistant", "content": json.dumps({
                "type": "sql",
                "sql": "SELECT region, revenue FROM seed WHERE order_date > '2024-12-01'"
            })},

            # PLOT → plot
            {"role": "user", "content": "bar chart of revenue by region"},
            {"role": "assistant", "content": json.dumps({
                "type": "plot",
                "plot": {"kind": "bar", "x": "region", "y": "revenue"}
            })},

            # REPORT → report
            {"role": "user", "content": "Generate a report (executive summary) of this dataset"},
            {"role": "assistant", "content": json.dumps({
                "type": "report",
                "title": "Executive Summary",
                "html": (
                    "<h2>Overview</h2>"
                    "<p>High-level description using the provided CONTEXT.</p>"
                    "<div class=\"nr-metrics\">"
                    "<div class=\"nr-metric\"><div class=\"lab\">Rows</div><div class=\"val\">{rows}</div></div>"
                    "<div class=\"nr-metric\"><div class=\"lab\">Columns</div><div class=\"val\">{cols}</div></div>"
                    "</div>"
                )
            })},

            # ANSWER → answer
            {"role": "user", "content": "Explain this dataset"},
            {"role": "assistant", "content": json.dumps({
                "type": "answer",
                "text": "This dataset includes several fields with limited missingness. Numeric columns show moderate spread; some outliers exist."
            })},
        ]

        # First pass
        data = self._call_and_parse(system, examples, message, trimmed)

        # Enforce routing after the model’s response
        t = (data.get("type") or "").lower()

        # If the user clearly asked for a table/manipulation, force SQL (one strict retry if needed)
        if wants_table and not wants_plot and not wants_report and t != "sql":
            strict_system = system + "\nHARD SQL MODE: The user asked for a table or data manipulation. You MUST return ONLY type=sql.\n"
            data2 = self._call_and_parse(strict_system, examples, message, trimmed)
            t2 = (data2.get("type") or "").lower()
            if t2 == "sql":
                data = data2
                t = "sql"

        # Minimal validation + graceful fallbacks
        if t not in {"answer", "sql", "plot", "report"}:
            return {"type": "answer", "text": "I can explain the data, run SQL/plots, or generate a report. Try asking for one of those."}

        if t == "sql":
            sql = (data.get("sql") or "").strip()
            if not sql.lower().startswith("select"):
                # Keep it friendly, but enforce SELECT-only
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
            if not html or ("<h2" not in html and "<p" not in html and "<ul" not in html):
                return {"type": "answer", "text": "Here’s a quick description of the data."}
            if not (data.get("title") or "").strip():
                data["title"] = "Report"

        return data

    # ---- helpers ----

    def _call_and_parse(self, system: str, examples: list, message: str, trimmed_ctx: dict) -> dict:
        rsp = self.client.chat.completions.create(
            model=self.model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                *examples,
                {"role": "user", "content": f"USER_MESSAGE:\n{message}\n\nCONTEXT:\n{json.dumps(trimmed_ctx, ensure_ascii=False, default=str)}"},
            ],
        )
        content = rsp.choices[0].message.content.strip()
        content = re.sub(r"^```json\s*|\s*```$", "", content, flags=re.MULTILINE)
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"type": "answer", "text": "Sorry, I couldn't parse a plan for that question."}


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
