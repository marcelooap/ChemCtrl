export function copyHtmlToClipboard(html) {
    try {
      const blob = new Blob([html], { type: "text/html" });
      const text = html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const textBlob = new Blob([text], { type: "text/plain" });
      navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob, "text/plain": textBlob }),
      ]);
      return true;
    } catch {
      const temp = document.createElement("div");
      temp.innerHTML = html;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      temp.style.top = "0";
      document.body.appendChild(temp);
      const range = document.createRange();
      range.selectNode(temp);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("copy");
      document.body.removeChild(temp);
      return true;
    }
  }