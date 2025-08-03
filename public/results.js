(function(global){
  let sendResults = [];

  function clearStatusDots(){
    sendResults = [];
    if(!global.document) return;
    const nodes = global.document.querySelectorAll('[id^="status-"]');
    nodes.forEach(n => { n.innerHTML = ''; });
  }

  function addResult(result){
    sendResults.push(result);
  }

  function resultsToCSV(){
    const header = ['fanId','username','parkerName','success','error'];
    const rows = sendResults.map(r => [
      r.fanId,
      r.username || '',
      r.parkerName || '',
      r.success ? 'success' : 'fail',
      r.error || ''
    ]);
    const all = [header, ...rows];
    return all.map(row => row.map(val => '"' + String(val).replace(/"/g, '""') + '"').join(',')).join('\n');
  }

  function downloadResults(){
    const csv = resultsToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url;
    a.download = 'send_results.csv';
    global.document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function getSendResults(){
    return sendResults;
  }

  function setSendResults(arr){
    sendResults = Array.isArray(arr) ? arr : [];
  }

  const api = { clearStatusDots, downloadResults, addResult, resultsToCSV, getSendResults, setSendResults };

  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  } else {
    global.clearStatusDots = clearStatusDots;
    global.downloadResults = downloadResults;
    global.addResult = addResult;
    global.resultsToCSV = resultsToCSV;
    global.OFEMResults = api;
  }
})(typeof window !== 'undefined' ? window : global);
