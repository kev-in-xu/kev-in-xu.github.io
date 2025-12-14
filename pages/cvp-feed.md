---
layout: single
title: CVP's Feed 📡
permalink: /projects/cvp-feed/
author_profile: false
---

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

<script>
  // TODO add show more buttons for long feeds and stop slicing topitems

  // 2. Initialize Supabase
  // Replace these with your actual Project URL and Anon Key (sb_publishable...)
  const SUPABASE_URL = 'https://lljbzkmtshufnzfnzawp.supabase.co'; 
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsamJ6a210c2h1Zm56Zm56YXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MTM1NDksImV4cCI6MjA3ODI4OTU0OX0.F-ARDzmDyzgLl49CWroQupwO6mbttQxgvxIxup92fv0';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Function to truncate the title
  function truncateTitle(title, maxLength) {
    if (!title || title.length <= maxLength) {
      return title;
    }
    // Cut the string and append '...'
    return title.substring(0, maxLength) + '...';
  }

  // 3. Helper to render each feed's entries
  function renderFeedGroup(feedName, feedUrl, items, feedDescription) {
    const MAX_VISIBLE_ITEMS = 5; // # of visible items before show more button
    const MAX_TITLE_LENGTH = 90; // Set a maximum character limit for the title
    const descriptionAttribute = feedDescription ? `data-tippy-content="${feedDescription}"` : '';    
    
    // RENDERS FEED HTML
    const feedHtml = feedUrl 
        ? `<a href="${feedUrl}" target="_blank" class="custom-feed-tooltip" rel="noopener noreferrer" ${descriptionAttribute}>${feedName}</a>`
        : feedName;
    
    // RENDERS ENTRIES HTML
    const listHtml = items.map((item, index) => {
        const displayTitle = truncateTitle(item.title, MAX_TITLE_LENGTH);
        
        // items beyond max visible get a diff html class for hiding and showing
        const visibilityClass = index >= MAX_VISIBLE_ITEMS ? 'hidden-feed-item' : '';

        return `
            <li class="${visibilityClass}">
              <a href="${item.link}" target="_blank" rel="noopener noreferrer" title="${item.title}">
                ${displayTitle}
              </a>
            </li>
        `;
    }).join("");

    let showMoreButton = '';
    if (items.length > MAX_VISIBLE_ITEMS) {
        // We add a data attribute to the button to link it to its specific feed container
        showMoreButton = `
            <button class="show-more-button" data-feed-name="${feedName}">
                Show ${items.length - MAX_VISIBLE_ITEMS} More Items
            </button>
        `;
    }

    const html = `
      <div class="feed">
        <h5>${feedHtml}</h5>
        <ul>${listHtml}</ul>
        ${showMoreButton}
      </div>`;
      
    document.getElementById("rss-feeds").insertAdjacentHTML('beforeend', html);
  }

  // Helper around render feed group to further group by type
  function renderTypeSection(title, feedsGroup, container) {
      if (Object.keys(feedsGroup).length === 0) return;

      // Create a header for the type (Podcasts, Newsletters, etc.)
      const sectionHeader = document.createElement('h3');
      sectionHeader.textContent = title;
      container.appendChild(sectionHeader);

      // Render the individual feed groups within this section
      Object.keys(feedsGroup).forEach(name => {
          renderFeedGroup(name, feedsGroup[name].url, feedsGroup[name].items, feedsGroup[name].description);
      });
  }

  // Define the millisecond constants globally
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // New function to format the date range
  function formatDateRange() {
      const currentDate = new Date();
      // Calculate two weeks ago
      const twoWeeksAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Define options for formatting
      const options = { month: 'long', day: 'numeric', year: 'numeric' };

      // Format the dates
      const startDate = twoWeeksAgo.toLocaleDateString(undefined, options);
      const endDate = currentDate.toLocaleDateString(undefined, options);

      // Construct the final string
      const dateRangeString = `New updates from <span style="font-style: italic;">${startDate} - ${endDate}</span>`;  

      // Insert into the HTML element
      document.getElementById('date-range-display').innerHTML = dateRangeString;  
      }

  // 4. Main Fetch Logic
  async function loadFeeds(daysAgo = 14) {
    // 1. Show loading and disable the dropdown
    document.getElementById('loading').style.display = 'block';
    document.getElementById('date-range-select').disabled = true;

    // 2. Calculate the start date based on the input
    const startDate = new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString();

    // Query: Fetch items + the name of the feed they belong to
    // We order by feed name first to make grouping easier, then by date
    const { data: feeds, error } = await supabase
      .from('feeds')
      .select(`
        name,
        site_url,
        feed_type,
        description,
        feed_items!inner(
          title,
          link,
          pub_date
        )
      `)
      .contains('audience', ['CVP']) // Only include feeds where audience contains 'CVP'
      .filter('feed_items.pub_date', 'gte', startDate) // Filter the *nested* feed_items array by date.
      .order('name', { ascending: true }) // Order feeds by name
      .order('pub_date', { foreignTable: 'feed_items', ascending: false }); // Order nested items by date

    if (error) {
      console.error('Error loading feeds:', error);
      document.getElementById('loading').innerText = 'Failed to load feeds.';
      return;
    }

    // Remove loading text and cleanup containers (remains the same)
    document.getElementById('loading').style.display = 'none';
    document.getElementById('date-range-select').disabled = false;

    // Clean up previous display
    const rssFeedsContainer = document.getElementById("rss-feeds");
    rssFeedsContainer.querySelectorAll('.feed').forEach(el => el.remove()); 
    rssFeedsContainer.querySelector('p')?.remove();
    rssFeedsContainer.querySelectorAll('h3').forEach(el => el.remove());

    // 5. Group feeds by Feed Type in JavaScript
    // The structure returned is: 
    // [{ name: "Acquired", feed_type: "podcast", feed_items: [{...}, {...}] }, ...]
    
    const groupedByType = {
        podcast: {},
        newsletter: {},
        other: {}
    };
    let totalItemsCount = 0;

    feeds.forEach(feed => {
        if (!feed.feed_items || feed.feed_items.length === 0) return;

        const feedName = feed.name;
        const siteUrl = feed.site_url;
        const feedDescription = feed.description;
        const feedType = feed.feed_type?.toLowerCase() || 'other'; // Normalize type
        const items = feed.feed_items; // The items are already grouped here!
        totalItemsCount += items.length;

        const typeGroup = groupedByType[feedType] || groupedByType['other'];

        // Initialize and assign the grouped data
        typeGroup[feedName] = { 
            url: siteUrl, 
            items: items, // Items are already a clean array of episodes/articles
            description: feedDescription
        };
    });
    
    // If no items found after filtering
    if (totalItemsCount === 0) {
        document.getElementById("rss-feeds").innerHTML += "<p>No recent updates.</p>";
        return;
    }

    // Render podcast/newsletter groups
    renderTypeSection("Newsletters", groupedByType.newsletter, rssFeedsContainer);
    renderTypeSection("Podcasts", groupedByType.podcast, rssFeedsContainer);

    // Set up show more buttons
    setupShowMoreListeners();

    // Initialize Custom Tooltips
    tippy('.custom-feed-tooltip', {
        // Options for appearance and timing
        delay: [50, 0],         // 🌟 FASTER OPENING: 50ms hover delay
        duration: [200, 200],   // Fade in/out duration
        theme: 'custom',        // 🌟 CUSTOM STYLING: Use a custom theme defined below
        arrow: false,
        allowHTML: false,
    });
}

  // Date range event listener
  document.addEventListener('DOMContentLoaded', () => {
      const selectElement = document.getElementById('date-range-select');

      // Initial load: Use the default selected value (14)
      loadFeeds(parseInt(selectElement.value)); 
      
      // Add event listener to re-run the fetch when the dropdown changes
      selectElement.addEventListener('change', (event) => {
          const days = parseInt(event.target.value);
          loadFeeds(days); // Re-fetch the data from the server
      });
  });

  // Show more event listener
  function setupShowMoreListeners() {
    // Get all buttons on the page
    document.querySelectorAll('.show-more-button').forEach(button => {
        button.addEventListener('click', (event) => {
            const btn = event.target;
            const feedContainer = btn.closest('.feed');
            
            // Find all hidden items inside this specific feed container
            const hiddenItems = feedContainer.querySelectorAll('.hidden-feed-item');

            // Toggle logic
            if (btn.textContent.includes('More')) {
                // Show the items
                console.log('Items found to show:', hiddenItems.length);
                hiddenItems.forEach(item => {
                    item.style.display = 'list-item'; // or 'block', depending on your CSS
                });
                btn.textContent = 'Show Less';
            } else {
                // Hide the items again
                console.log('Items found to hide:', hiddenItems.length);
                hiddenItems.forEach(item => {
                    item.style.display = 'none';
                });
                
                // Reset button text
                const allItems = feedContainer.querySelectorAll('ul li');
                const totalItems = allItems.length;
                const hiddenCount = totalItems - 5;
                btn.textContent = `Show ${hiddenCount} More Items`;
            }
        });
    });
}
</script>