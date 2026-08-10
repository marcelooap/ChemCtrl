/**
 * Copia HTML formatado + texto plano para a área de transferência.
 * Preferência: ClipboardItem (text/html + text/plain).
 * Fallback: seleção em área contenteditable (preserva HTML no Outlook/Word).
 */
export async function copyHtmlToClipboard(html, plainText = "") {
  const text =
    plainText ||
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blobHtml = new Blob([html], { type: "text/html" });
      const blobText = new Blob([text], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blobHtml,
          "text/plain": blobText,
        }),
      ]);
      return true;
    } catch {
      // segue para fallback
    }
  }

  return copyHtmlViaContentEditable(html);
}

function copyHtmlViaContentEditable(html) {
  const host = document.createElement("div");
  host.setAttribute("contenteditable", "true");
  host.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;";
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(host);
    selection.removeAllRanges();
    selection.addRange(range);
    host.focus();
    const ok = document.execCommand("copy");
    selection.removeAllRanges();
    return !!ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(host);
  }
}
