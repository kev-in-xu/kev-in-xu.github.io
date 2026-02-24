async function callGeminiHello() {
  const res = await fetch(
    "https://lljbzkmtshufnzfnzawp.supabase.co/functions/v1/gemini-hello", {
    method: "POST",
    })

  if (!res.ok) {
    console.error("Gemini function failed", await res.text());
    return;
  }

  const data = await res.json();
  console.log("Gemini says:", data.reply, data);
  return data.reply;
}