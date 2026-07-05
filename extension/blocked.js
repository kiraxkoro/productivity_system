// Extension pages can't run inline scripts (MV3 CSP), so this lives here.
const params = new URLSearchParams(location.search);
const label = params.get("label") || "Focus block";
const until = params.get("until") || "";
document.getElementById("until").textContent = until
  ? `${label} — runs until ${until}`
  : label;
