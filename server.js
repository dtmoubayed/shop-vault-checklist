require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vault API Configuration
const VAULT_API_BASE_URL = 'https://vault.shopify.io/api/v1';
const VAULT_API_TOKEN = process.env.VAULT_API_TOKEN;

// Shopify LLM Gateway Configuration
const LLM_GATEWAY_BASE_URL = 'https://llm-gateway.shopify.io/api/v1';

// Create Vault API client with environment token
const vaultApi = axios.create({
  baseURL: VAULT_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${VAULT_API_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// Checklist items
const CHECKLIST_ITEMS = [
  {
    id: 'title',
    title: 'Project title is descriptive, accurate, and avoids Shopify-specific acronyms',
    description: 'Use clear, descriptive language that anyone in the company can understand. Avoid acronyms like "PDP" or "SFAPI" without explanation.'
  },
  {
    id: 'priority',
    title: 'Project has a priority set',
    description: 'P0: Critical, company-level priority with executive visibility\nP1: High priority, key to quarterly goals\nP2: Medium priority, important but can be sequenced after P1s\nP3: Low priority, nice-to-have'
  },
  {
    id: 'product_id',
    title: 'Project has a Product ID (e.g., "Shop Sign In")',
    description: 'The Product ID should be a short, memorable name that can be used in conversations and documentation to refer to your project.'
  },
  {
    id: 'tags',
    title: 'Project has appropriate tags for discoverability',
    description: 'Include tags related to product area, technology, target audience, and strategic initiatives to make your project more discoverable.'
  },
  {
    id: 'status',
    title: 'Project is in the correct status (On Track, At Risk, Off Track)',
    description: 'On Track: Project is proceeding as planned\nAt Risk: Project has issues that may impact timeline or scope\nOff Track: Project has significant issues affecting delivery'
  },
  {
    id: 'risks',
    title: 'Risks and blockers are accurately documented and marked if applicable',
    description: 'Clearly document any risks or blockers in your project'
  }
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Analyze project endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { urls, token } = req.body;
    
    console.log('Received analyze request:', { urls, hasToken: !!token });
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'At least one project URL is required' });
    }

    if (!token) {
      return res.status(401).json({ error: 'API token is required' });
    }

    // Create LLM Gateway client with user's token
    const llmGateway = axios.create({
      baseURL: LLM_GATEWAY_BASE_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Process each URL
    const results = await Promise.all(urls.map(async (url) => {
      try {
        // Extract project ID from URL
        const projectId = extractProjectId(url);
        if (!projectId) {
          throw new Error('Invalid Vault project URL');
        }
        
        // Fetch project details from Vault API
        const projectDetails = await fetchProjectDetails(projectId);
        
        // Analyze project using LLM Gateway
        const analysis = await analyzeProject(projectDetails, llmGateway);
        
        return {
          projectDetails,
          analysis
        };
      } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        return {
          error: error.message,
          url
        };
      }
    }));

    res.json(results);
  } catch (error) {
    console.error('Error analyzing projects:', error);
    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Invalid API token' });
    } else {
      res.status(500).json({ error: 'Failed to analyze projects' });
    }
  }
});

// Helper function to extract project ID from URL
function extractProjectId(url) {
  const match = url.match(/\/projects\/([^\/]+)/);
  return match ? match[1] : null;
}

// Fetch project details from Vault API
async function fetchProjectDetails(projectId) {
  try {
    const response = await vaultApi.get(`/projects/${projectId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching project details:', error);
    throw error;
  }
}

// Analyze project using LLM Gateway
async function analyzeProject(projectDetails, llmGateway) {
  try {
    const prompt = `Analyze the following Vault project against our checklist. For each item, determine if it's completed and provide a brief analysis:

Project Details:
Title: ${projectDetails.title}
Description: ${projectDetails.description || 'No description'}
Status: ${projectDetails.status || 'Not set'}
Priority: ${projectDetails.priority || 'Not set'}
Tags: ${projectDetails.tags?.join(', ') || 'No tags'}
Risks: ${projectDetails.risks || 'No risks documented'}

Checklist Items:
${CHECKLIST_ITEMS.map(item => `- ${item.title}`).join('\n')}

Please analyze each checklist item and return a JSON response with the following structure:
{
  "checklist": [
    {
      "id": "item_id",
      "completed": true/false,
      "status": "passed/failed/partial",
      "analysis": "Brief explanation of why this item passed/failed/partially passed"
    }
  ]
}`;
    
    const response = await llmGateway.post('/analyze', {
      prompt,
      model: 'gpt-4',
      max_tokens: 2000,
      temperature: 0.3
    });
    
    return {
      checklist: CHECKLIST_ITEMS.map(item => {
        const analysis = response.data.checklist.find(c => c.id === item.id);
        return {
          ...item,
          completed: analysis?.completed || false,
          status: analysis?.status || 'failed',
          analysis: analysis?.analysis || 'No analysis available'
        };
      })
    };
  } catch (error) {
    console.error('Error analyzing project with LLM:', error);
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Open http://localhost:${port} in your browser`);
}); 