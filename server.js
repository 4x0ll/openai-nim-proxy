// server.js - JanitorAI NVIDIA NIM Proxy for DeepSeek R1
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NVIDIA_API_KEY;

// 🔥 DeepSeek R1 Configuration
const DEEPSEEK_R1_MODEL = 'deepseek/deepseek-r1:latest';
const SHOW_REASONING = true;
const ENABLE_THINKING_MODE = true;

// Health check endpoint (GET)
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'JanitorAI DeepSeek R1 Proxy',
    model: DEEPSEEK_R1_MODEL,
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// JanitorAI connection test (POST) - CRITICAL FIX!
app.post('/', (req, res) => {
  console.log('JanitorAI connection test received');
  res.json({ 
    status: 'online',
    message: 'Proxy is ready for JanitorAI',
    endpoints: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      test: '/test'
    }
  });
});

// List models endpoint
app.get('/v1/models', (req, res) => {
  const models = [{
    id: 'gpt-4',
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim'
  }, {
    id: 'deepseek-r1',
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim'
  }];
  
  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature = 0.8, max_tokens = 1500 } = req.body;
    
    console.log('JanitorAI chat request received');
    
    const nimRequest = {
      model: DEEPSEEK_R1_MODEL,
      messages: messages,
      temperature: temperature,
      max_tokens: max_tokens,
      extra_body: ENABLE_THINKING_MODE ? { 
        chat_template_kwargs: { thinking: true }
      } : undefined,
      stream: false
    };
    
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Transform to OpenAI format
    let fullContent = response.data.choices?.[0]?.message?.content || '';
    const reasoningContent = response.data.choices?.[0]?.message?.reasoning_content || '';
    
    if (SHOW_REASONING && reasoningContent) {
      fullContent = `<think>\n${reasoningContent}\n</think>\n\n${fullContent}`;
    }
    
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: fullContent
        },
        finish_reason: response.data.choices?.[0]?.finish_reason || 'stop'
      }],
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
    
    console.log('Response sent successfully');
    res.json(openaiResponse);
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      error: {
        message: error.response?.data?.error?.message || 'Internal server error',
        type: 'api_error'
      }
    });
  }
});

// Test endpoint
app.post('/test', async (req, res) => {
  try {
    const testPayload = {
      model: DEEPSEEK_R1_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a charismatic fantasy character in a roleplaying game.'
        },
        {
          role: 'user',
          content: '*I approach you in the tavern* Hello there, stranger. Care for a drink and a tale?'
        }
      ],
      temperature: 0.8,
      max_tokens: 200
    };
    
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, testPayload, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      success: true,
      model: DEEPSEEK_R1_MODEL,
      response: response.data.choices[0].message.content,
      reasoning: response.data.choices[0].message.reasoning_content
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`=== JanitorAI DeepSeek R1 Proxy ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Model: ${DEEPSEEK_R1_MODEL}`);
  console.log(`URL: https://openai-nim-proxy-wttu.onrender.com`);
  console.log(`=================================`);
});
