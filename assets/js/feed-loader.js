// TODO add a summary block where you can prompt LLMs to generate a highlight from all the scraped data
// TODO updated supabase edge function to see if I can put the feed items manually

// 2. Initialize Supabase
// Replace these with your actual Project URL and Anon Key (sb_publishable...)
const SUPABASE_URL = 'https://lljbzkmtshufnzfnzawp.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsamJ6a210c2h1Zm56Zm56YXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MTM1NDksImV4cCI6MjA3ODI4OTU0OX0.F-ARDzmDyzgLl49CWroQupwO6mbttQxgvxIxup92fv0';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const MS_PER_DAY = 24 * 60 * 60 * 1000; // Define the millisecond constants globally

// Helper: Truncates titles that are too long
// Returns shortened title string with '...' if it exceeds maxLength
function truncateTitle(title, maxLength) {
    if (!title || title.length <= maxLength) {
        return title;
    }
    // Cut the string and append '...'
    return title.substring(0, maxLength) + '...';
}

// Helper: Renders a single channel's feed items. Inserts into HTML
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

// Helper: Wrapper for FeedGroup
function renderTypeSection(title, feedsGroup, container) {
    if (Object.keys(feedsGroup).length === 0) return;

    // Create a header for the type (Podcasts, Newsletters, etc.)
    const sectionHeader = document.createElement('h3');
    sectionHeader.textContent = title;
    container.appendChild(sectionHeader);

    // Render the individual feed groups within this section
    Object.keys(feedsGroup).forEach(name => {
        renderFeedGroup(name, feedsGroup[name].url, 
            feedsGroup[name].items, feedsGroup[name].description);
    });
}

// Show more button event listener setup
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

function cleanUpUI(rssFeedsContainer) {
    // Remove loading text and cleanup containers (remains the same)
    document.getElementById('loading').style.display = 'none';
    document.getElementById('date-range-select').disabled = false;

    // Clean up previous display
    
    rssFeedsContainer.querySelectorAll('.feed').forEach(el => el.remove()); 
    rssFeedsContainer.querySelector('p')?.remove();
    rssFeedsContainer.querySelectorAll('h3').forEach(el => el.remove());
}

// 4. Main Fetch Function
async function loadFeeds(daysAgo = 14, audience = ['CVP']) {
    // 1. Show loading and disable the dropdown
    document.getElementById('loading').style.display = 'block';
    document.getElementById('date-range-select').disabled = true;

    // 2. Calculate the start date based on the input
    const startDate = new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString();

    // 3. Query: Fetch items + the name of the feed they belong to
    // We order by feed name first to make grouping easier, then by date
    const { data: feeds, error } = await supabaseClient
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
      .contains('audience', audience) // Only include feeds where audience contains 'CVP'
      .filter('feed_items.pub_date', 'gte', startDate) // Filter the *nested* feed_items array by date.
      .order('name', { ascending: true }) // Order feeds by name
      .order('pub_date', { foreignTable: 'feed_items', ascending: false }); // Order nested items by date

    if (error) {
      console.error('Error loading feeds:', error);
      document.getElementById('loading').innerText = 'Failed to load feeds.';
      return;
    }

    // 4. Clean up previous UI
    const rssFeedsContainer = document.getElementById("rss-feeds");
    cleanUpUI(rssFeedsContainer);
   
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

    // 6. Organize and Render Feeds by Type
    renderTypeSection("Newsletters 📰", groupedByType.newsletter, rssFeedsContainer);
    renderTypeSection("Podcasts 🎧", groupedByType.podcast, rssFeedsContainer);

    // 7. Set up show more buttons
    setupShowMoreListeners(); 

    // 8. Initialize Custom Tooltips
    tippy('.custom-feed-tooltip', {
        // Options for appearance and timing
        delay: [50, 0],         // 50ms hover delay
        duration: [200, 200],   // Fade in/out duration
        theme: 'custom',        // Use a custom theme defined below
        arrow: false,
        allowHTML: false,
    });
}
