---
title: "Testpage"
permalink: /test/
---

This is a test page.

<p id="result">Loading…</p>

<script src="{{ '/assets/js/test.js' | relative_url }}"></script>

<script>
  callGeminiHello()
  .then(reply => {
    document.getElementById("result").textContent = reply;
  })
  .catch(err => {
    document.getElementById("result").textContent = "Error: " + err.message;
  });
</script>
