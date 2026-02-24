---
title: Kevin's Feed
permalink: /projects/kevin-feed/
classes: page--kevin-feed
---
<small>personal feed</small>
<hr>
<div id="rss-feeds">
  <small>
    Updates from the last:
    <select id="date-range-select">
      <option value="3">3 Days</option>
      <option value="7">1 Week</option>
      <option value="14" selected>2 Weeks</option>
      <option value="30">1 Month</option>
    </select>
  </small>
  
  <div id="loading" style="margin-top: 1rem; color: #666;">Loading feeds...</div>
</div>

<style>
  
</style>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://unpkg.com/@popperjs/core@2"></script>
<script src="https://unpkg.com/tippy.js@6"></script>

<script src="{{ '/assets/js/feed-loader.js' | relative_url }}"></script>

<script>
  // Date range event listener
  document.addEventListener('DOMContentLoaded', () => {
    const selectElement = document.getElementById('date-range-select');

    // Initial load: Use the default selected value (14)
    loadFeeds(parseInt(selectElement.value), ['Kevin']); 
    
    // Add event listener to re-run the fetch when the dropdown changes
    selectElement.addEventListener('change', (event) => {
      const days = parseInt(event.target.value);
      loadFeeds(days, ['Kevin']); // Re-fetch the data from the server
    });
  });
</script>
