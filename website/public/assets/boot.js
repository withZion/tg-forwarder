/* Before first paint. The animations are subtle, so they play for every visitor, even when the
   device asks for reduced motion. Preview the calm version with ?motion=reduced (lasts for the tab). */
(function () {
  var root = document.documentElement, full = true;
  root.classList.add("js");
  try {
    var q = location.search;
    if (/[?&]motion=reduced(&|$)/.test(q)) sessionStorage.setItem("motion", "reduced");
    else if (/[?&]motion=full(&|$)/.test(q)) sessionStorage.removeItem("motion");
    full = sessionStorage.getItem("motion") !== "reduced";
  } catch (e) {}
  if (!full) return;
  root.classList.add("force-motion");
  var mm = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    if (!/prefers-reduced-motion/.test(query)) return mm(query);
    return { matches: false, media: query, onchange: null, addListener: function () {}, removeListener: function () {},
             addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
  };
})();
