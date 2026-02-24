export default async function handler(req, res) {
    try {
      const pubid = req.query.pubid || "";           // e.g. US9657079B2
      const num = pubid.match(/\d+/)?.[0];           // 9657079
      if (!num) return res.status(400).json({ error: "Bad pubid" });
  
      // 1) Fetch the patent + continuity block
      const q = encodeURIComponent(JSON.stringify({ patent_id: num }));
      const fields = encodeURIComponent(JSON.stringify([
      "patent_id","patent_title","patent_date","patent_abstract",
      "assignees","inventors","cpc_current",
      // continuity (parent/related docs on this patent)
      "us_related_documents"  // includes: related_doc_number, kind, type, status, published_date, etc.
      ]));

      const r = await fetch(
      `https://search.patentsview.org/api/v1/patent/?q=${q}&f=${fields}`,
      { headers: { "X-Api-Key": process.env.PATENTSVIEW_KEY } }
      );
      if (!r.ok) return res.status(r.status).json({ error: "Upstream error", status: r.status });
      const data = await r.json();
      const p = data?.patents?.[0];
      if (!p) return res.status(404).json({ error: "Not found" });

      // Map core fields
      const base = {
      number: p.patent_id,
      title: p.patent_title,
      grant_date: p.patent_date,
      abstract: p.patent_abstract,
      assignees: p.assignees?.map(a => a.assignee_organization).filter(Boolean),
      inventors: p.inventors?.map(i => [i.inventor_name_first, i.inventor_name_last].filter(Boolean).join(" ")),
      cpcs: p.cpc_current?.map(c => c.cpc_subclass_id).filter(Boolean)
      };

      // Normalize continuity on THIS patent (often “parents/related”)
      const related = (p.us_related_documents || []).map(r => ({
      country: r.published_country,
      number: r.related_doc_number,
      kind: r.related_doc_kind,
      type: r.related_doc_type,       // e.g., continuation, CIP, divisional, etc. (as provided by PV)
      status: r.related_doc_status,     // PV status text
      published_date: r.related_doc_published_date
      }));

      const json = {
      ...base,
      related
      };
  
  
      // Cache at the edge so repeat lookups are free/instant
      res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=86400");
      return res.status(200).json(json);
    } catch (e) {
      return res.status(500).json({ error: "Server error", detail: String(e) });
    }
  }
