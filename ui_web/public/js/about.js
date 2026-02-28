(() => {
  const blocks = Array.from(document.querySelectorAll(".about-reveal"));
  if (!blocks.length) return;

  if (!("IntersectionObserver" in window)) {
    blocks.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );

  blocks.forEach((el, index) => {
    el.style.setProperty("--about-delay", `${Math.min(index * 90, 450)}ms`);
    observer.observe(el);
  });
})();
