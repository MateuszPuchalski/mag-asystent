/* Wysokość wspólnego paska zależy od zawinięcia nawigacji i nazwy użytkownika.
   Pomiar utrzymuje szuflady pod nagłówkiem także po zalogowaniu i zmianie szerokości. */
(() => {
  const header = document.getElementById("bok");
  const observer = new ResizeObserver(() => {
    const sticky = getComputedStyle(header).position === "sticky";
    document.documentElement.style.setProperty(
      "--hChrome",
      `${sticky ? header.getBoundingClientRect().height : 0}px`,
    );
  });
  observer.observe(header);
})();
