const uploadForm = document.getElementById("uploadForm");
const result = document.getElementById("result");

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  result.textContent = "Uploading...";

  const data = new FormData();
  data.append("file", document.getElementById("fileInput").files[0]);
  const name = document.getElementById("nameInput").value.trim();
  if (name) data.append("name", name);

  const resp = await fetch("/upload", { method: "POST", body: data });
  const json = await resp.json();

  result.textContent = JSON.stringify(json, null, 2);
});

document.getElementById("listVaultForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = new URLSearchParams({
    query: vaultQuery.value,
    limit: vaultLimit.value,
    offset: vaultOffset.value
  });
  const resp = await fetch(`/vault/media?${params}`);
  vaultListResult.textContent = JSON.stringify(await resp.json(), null, 2);
});

document.getElementById("addToListForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ids = mediaIdsInput.value.split(",").map(s => s.trim()).filter(Boolean);

  const resp = await fetch("/vault/lists/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds: ids })
  });

  addToListResult.textContent = JSON.stringify(await resp.json(), null, 2);
});
