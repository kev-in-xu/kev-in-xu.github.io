---
layout: single
title: "Miscellaneous"
permalink: /misc/
gallery:
  - url: /assets/images/gallery/blue-oysters.jpg
    image_path: /assets/images/gallery/blue-oysters.jpg
    alt: "blue-oysters"
    title: "blue-oysters"
  - url: /assets/images/gallery/butterfly1.jpg
    image_path: /assets/images/gallery/butterfly1.jpg
    alt: "butterfly1"
    title: "butterfly1"
  - url: /assets/images/gallery/butterfly2.jpg
    image_path: /assets/images/gallery/butterfly2.jpg
    alt: "butterfly2"
    title: "butterfly2"
  - url: /assets/images/gallery/flowers1.jpg
    image_path: /assets/images/gallery/flowers1.jpg
    alt: "flowers1"
    title: "flowers1"
  - url: /assets/images/gallery/mallards.jpg
    image_path: /assets/images/gallery/mallards.jpg
    alt: "mallards"
    title: "mallards"
  - url: /assets/images/gallery/torch-lily.jpg
    image_path: /assets/images/gallery/torch-lily.jpg
    alt: "torch-lily"
    title: "torch-lily"
---

{% include gallery caption="*Shot on iPhone* 🤳" %}


<div id="rss-feeds">
    <h2>My Radar 📡</h2>
  </div>

  <style>
    .feed h5 {
      margin-bottom: 0.2rem;
    }
  
    .feed ul {
      list-style: none;
      padding-left: 0;
    }
  
    .feed li {
      margin: -0.2rem 0; /* Less space between items */
    }
  
    .feed li a {
      font-size: 0.85rem;
      color: #555;
      text-decoration: none;
    }
  
    .feed li a:hover {
      text-decoration: underline;
    }
  </style>
  
  <script>
    const feeds = [
      { name: "Bits in Bio", url: "https://bitsinbio.substack.com/feed" },
      { name: "Acquired", url: "https://feeds.transistor.fm/acquired" },
      { name: "Century of Bio", url: "https://centuryofbio.com/feed" }

    ];
  
    function renderFeed(name, items) {
      const html = `
        <div class="feed">
          <h5>${name}</h5>
          <ul>${items.map(item => `<li><a href="${item.link}" target="_blank">${item.title}</a></li>`).join("")}</ul>
        </div>`;
      document.getElementById("rss-feeds").innerHTML += html;
    }
  
    feeds.forEach(feed => {
      fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`)
        .then(response => response.json())
        .then(data => renderFeed(feed.name, data.items.slice(0, 3)))
        .catch(err => console.error(`Failed to load ${feed.name}`, err));
    });
  </script>

More to come