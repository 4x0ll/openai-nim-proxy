const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Try different NVIDIA endpoints
const NIM_ENDPOINTS = [
  'https://integrate.api.nvidia.com/v1',
  'https://api.nvcf.nvidia.com/v1',
  'https://ai.api.nvidia.com/v1'
];

const NIM_API_KEY = process.env.NVIDIA_API_KEY;

// List of available models to try
const AVAILABLE_MODELS = [
  'deepseek/deepseek-r1:latest',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3.1',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'mistralai/mistral-7b-instruct'
];

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'JanitorAI Proxy - Diagnostic Mode',
    endpoints: ['/diagnose', '/test-simple', '/v1/chat/completions']
  });
});

// Diagnostic endpoint to find working config
app.get('/diagnose', async (req, res) => {
  const results = [];
  
  for (const endpoint of NIM_ENDPOINTS) {
    for (const model of AVAILABLE_MODELS.slice(0, 3)) { // Test first 3 models
      try {
        console.log(`Testing: ${endpoint} with ${model}`);
        
        const response = await axios.post(`${endpoint}/chat/completions`, {
          model: model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        }, {
          headers: {
            'Authorization': `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        });
        
        results.push({
          endpoint,
          model,
          status: 'SUCCESS',
          response: response.data.choices[0].message.content
        });
        
        // If we find a working combo, stop testing
        break;
        
      } catch (error) {
        results.push({
          endpoint,
          model,
          status: 'FAILED',
          error: error.response?.status || error.code,
          message: error.response?.data?.error?.message || error.message
        });
      }
    }
  }
  
  res.json({
    nvidia_api_key_exists: !!NIM_API_KEY,
    key_prefix: NIM_API_KEY ? NIM_API_KEY.substring(0, 10) + '...' : 'none',
    results
  });
});

// Simple test with known working model
app.post('/test-simple', async (req, res) => {
  try {
    // Try Llama 3.1 8B first (almost always works)
    const testPayload = {
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'Say "Hello World" only' }],
      max_tokens: 10
    };
    
    // Try first endpoint
    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      testPayload,
      {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json({
      success: true,
      message: 'NVIDIA API is working!',
      endpoint: 'https://integrate.api.nvidia.com/v1',
      model: 'meta/llama-3.1-8b-instruct',
      response: response.data.choices[0].message.content
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      },
      help: 'Check if your NVIDIA API key has access to NIM models'
    });
  }
});

// Working chat endpoint using confirmed config
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature = 0.8, max_tokens = 1000 } = req.body;
    
    console.log('Chat request received, message count:', messages.length);
    
    // First try DeepSeek, fallback to Llama
    const modelsToTry = [
      'deepseek/deepseek-r1',
      'deepseek/deepseek-v3.1',
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.1-8b-instruct'
    ];
    
    let lastError = null;
    
    for (const model of modelsToTry) {
      try {
        console.log(`Trying model: ${model}`);
        
        const response = await axios.post(
          'https://integrate.api.nvidia.com/v1/chat/completions',
          {
            model: model,
            messages: messages,
            temperature: temperature,
            max_tokens: max_tokens,
            stream: false
          },
          {
            headers: {
              'Authorization': `Bearer ${NIM_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
        
        console.log(`Success with model: ${model}`);
        
        // Return in OpenAI format
        res.json({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4', // Tell JanitorAI it's GPT-4
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: response.data.choices[0].message.content
            },
            finish_reason: 'stop'
          }],
          usage: response.data.usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        });
        
        return; // Success, exit function
        
      } catch (error) {
        lastError = error;
        console.log(`Model ${model} failed:`, error.response?.status || error.message);
        // Continue to next model
      }
    }
    
    // All models failed
    throw lastError;
    
  } catch (error) {
    console.error('All models failed:', error.message);
    
    res.status(500).json({
      error: {
        message: 'Service temporarily unavailable',
        type: 'api_error',
        details: 'Unable to connect to AI models'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Diagnostic server running on port ${PORT}`);
  console.log(`Visit: https://openai-nim-proxy-wttu.onrender.com/diagnose`);
});
