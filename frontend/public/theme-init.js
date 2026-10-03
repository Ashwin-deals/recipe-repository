// Applies a saved theme before first paint (no flash). External file: the CSP blocks inline scripts.
try {
  var saved = localStorage.getItem("cartchef:theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch (e) {
  /* storage blocked: follow the system theme */
}
