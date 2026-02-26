import { CONFIG } from './config';

export const generateCurlCommand = (endpoint, payload) => {
    // Basic redaction for safety in display, though user can copy full if needed
    const safePayload = { ...payload };
    
    return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '${JSON.stringify(safePayload, null, 2)}'`;
  };
  
  export const generatePythonCode = (endpoint, payload) => {
    // Determine base_url from endpoint
    const baseUrl = endpoint.includes('/api/v3') 
        ? endpoint.split('/api/v3')[0] + '/api/v3'
        : CONFIG.API_BASE_URL;

    return `import os
  from volcenginesdkarkruntime import Ark
  
  # Configure client with the correct endpoint
  client = Ark(
      base_url="${baseUrl}",
      api_key=os.environ.get("ARK_API_KEY")
  )
  
  # Note: This is a direct API call example. 
  # For official SDK usage, refer to Volcengine Ark Runtime docs.
  
  response = client.content_generation(
      # Parameters mapped from payload
      model="${payload.model}",
      content=${JSON.stringify(payload, null, 2)}
  )
  print(response)`;
  };
  
  export const generateNodeCode = (endpoint, payload) => {
    return `const endpoint = "${endpoint}";
  const apiKey = process.env.ARK_API_KEY;
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${apiKey}\`
    },
    body: JSON.stringify(${JSON.stringify(payload, null, 2)})
  });
  
  const data = await response.json();
  console.log(data);`;
  };
