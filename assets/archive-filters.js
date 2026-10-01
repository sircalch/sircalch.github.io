(function () {
  "use strict";

  function initArchiveFilters() {
    var table = document.querySelector("#archive-table");
    if (!table) return;

    var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr[data-object-id]"));
    var controls = Array.prototype.slice.call(document.querySelectorAll("[data-archive-filter]"));
    var count = document.querySelector("#archive-result-count");
    var reset = document.querySelector("#archive-reset");
    var total = rows.length;

    function matches(row, field, value) {
      if (!value) return true;
      var normalized = value.toLowerCase();
      if (field === "search") return row.textContent.toLowerCase().indexOf(normalized) !== -1;
      var raw = (row.dataset[field] || "").toLowerCase();
      return raw.split("|").indexOf(normalized) !== -1 || raw === normalized;
    }

    function apply() {
      var visible = 0;
      rows.forEach(function (row) {
        var show = controls.every(function (control) {
          return matches(row, control.dataset.archiveFilter, control.value.trim());
        });
        row.hidden = !show;
        if (show) visible += 1;
      });
      if (count) {
        count.textContent = count.dataset.template
          .replace("{visible}", String(visible))
          .replace("{total}", String(total));
      }
    }

    controls.forEach(function (control) {
      control.addEventListener("input", apply);
      control.addEventListener("change", apply);
    });
    if (reset) {
      reset.addEventListener("click", function () {
        controls.forEach(function (control) { control.value = ""; });
        apply();
      });
    }

    var query = new URLSearchParams(window.location.search);
    ["year", "type", "topic", "project", "language", "status"].forEach(function (field) {
      var value = query.get(field);
      var control = document.querySelector('[data-archive-filter="' + field + '"]');
      if (value && control) control.value = value;
    });
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initArchiveFilters);
  } else {
    initArchiveFilters();
  }
}());
