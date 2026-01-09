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
const NIM_API_KEY = process.env.NVIDIA_API_KEY; // Changed to match Render env var

// 🔥 DeepSeek R1 Configuration
const DEEPSEEK_R1_MODEL = 'deepseek/deepseek-r1:latest'; // Verified model name
const SHOW_REASONING = true; // Set to true to see DeepSeek's thought process
const ENABLE_THINKING_MODE = true; // Enable DeepSeek's reasoning capabilities

// 🔥 JanitorAI Roleplay Optimizations
const DEFAULT_TEMPERATURE = 0.85; // Higher for creative roleplay
const DEFAULT_MAX_TOKENS = 1500; // Longer responses for roleplay
const DEFAULT_TOP_P = 0.95; // Better for creative writing

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'JanitorAI DeepSeek R1 Proxy',
    model: DEEPSEEK_R1_MODEL,
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// List models endpoint (OpenAI compatible for JanitorAI)
app.get('/v1/models', (req, res) => {
  const models = [{
    id: 'deepseek-r1',
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim'
  }, {
    id: 'gpt-4',
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim'
  }];
  
  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint - MAIN JANITORAI ENDPOINT
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { 
      model = 'deepseek-r1', 
      messages, 
      temperature = DEFAULT_TEMPERATURE, 
      max_tokens = DEFAULT_MAX_TOKENS,
      top_p = DEFAULT_TOP_P,
      stream = false 
    } = req.body;
    
    console.log('Received JanitorAI request:', {
      messageCount: messages?.length,
      lastMessage: messages?.[messages.length - 1]?.content?.substring(0, 100) + '...'
    });
    
    // Always use DeepSeek R1 for JanitorAI
    const nimModel = DEEPSEEK_R1_MODEL;
    
    // 🔥 OPTIMIZED FOR ROLEPLAY: Enhance system prompt for better character responses
    let enhancedMessages = [...messages];
    
    // Add roleplay optimization if it's a user message
    const lastMessage = enhancedMessages[enhancedMessages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && enhancedMessages.length > 1) {
      // Find the system message or add our optimization
      const systemMessageIndex = enhancedMessages.findIndex(m => m.role === 'system');
      
      if (systemMessageIndex === -1) {
        // Add optimized system prompt for roleplay
        enhancedMessages.unshift({
          role: 'system',
          content: `You are an expert roleplay AI assistant. Respond in character, providing detailed, engaging, and immersive responses. 
          Stay in character at all times. Use descriptive language and show emotions through actions and dialogue.
          IMPORTANT: For reasoning, use the <think> tags provided by DeepSeek R1. Your final response should be natural and in-character.`
        });
      }
    }
    
    // Transform to NIM format with DeepSeek R1 optimizations
    const nimRequest = {
      model: nimModel,
      messages: enhancedMessages,
      temperature: Math.min(Math.max(temperature, 0.1), 2.0), // Clamp to safe range
      max_tokens: Math.min(Math.max(max_tokens, 100), 4000), // Clamp to safe range
      top_p: top_p,
      extra_body: ENABLE_THINKING_MODE ? { 
        chat_template_kwargs: { 
          thinking: true,
          reasoning_stop_string: '</think>' // Explicit stop for reasoning
        } 
      } : undefined,
      stream: stream
    };
    
    console.log('Forwarding to NVIDIA NIM with model:', nimModel);
    
    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });
    
    if (stream) {
      // Handle streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let buffer = '';
      
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            
            if (dataStr.trim() === '[DONE]') {
              res.write('data: [DONE]\n\n');
              return;
            }
            
            try {
              const data = JSON.parse(dataStr);
              
              // Transform to OpenAI format
              if (data.choices?.[0]?.delta) {
                const openaiDelta = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: model,
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: null
                  }]
                };
                
                // Handle reasoning content for DeepSeek R1
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;
                
                if (SHOW_REASONING && reasoning) {
                  // Show reasoning in <think> tags
                  openaiDelta.choices[0].delta.content = `<think>${reasoning}</think>\n\n${content || ''}`;
                } else if (content) {
                  // Just show content (hide reasoning)
                  openaiDelta.choices[0].delta.content = content;
                }
                
                // Send in OpenAI format
                res.write(`data: ${JSON.stringify(openaiDelta)}\n\n`);
              }
            } catch (e) {
              // Forward as-is if parsing fails
              res.write(line + '\n');
            }
          }
        });
      });
      
      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });
      
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
      
    } else {
      // Non-streaming response
      const nimResponse = response.data;
      
      // Transform to OpenAI format
      let fullContent = nimResponse.choices?.[0]?.message?.content || '';
      const reasoningContent = nimResponse.choices?.[0]?.message?.reasoning_content || '';
      
      // Combine reasoning and content based on SHOW_REASONING setting
      if (SHOW_REASONING && reasoningContent) {
        fullContent = `<think>\n${reasoningContent}\n</think>\n\n${fullContent}`;
      }
      
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: fullContent
          },
          finish_reason: nimResponse.choices?.[0]?.finish_reason || 'stop'
        }],
        usage: nimResponse.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      console.log('Response sent to JanitorAI, token count:', openaiResponse.usage.total_tokens);
      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    res.status(error.response?.status || 500).json({
      error: {
        message: error.response?.data?.error?.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Test endpoint for DeepSeek R1
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
      temperature: 0.85,
      max_tokens: 300
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
      reasoning: response.data.choices[0].message.reasoning_content,
      tokens: response.data.usage
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// JanitorAI specific endpoint
app.post('/janitor/v1/chat', async (req, res) => {
  // Alias for JanitorAI
  req.body.model = 'deepseek-r1';
  req.app.post('/v1/chat/completions')(req, res);
});

app.listen(PORT, () => {
  console.log(`=== JanitorAI DeepSeek R1 Proxy ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Model: ${DEEPSEEK_R1_MODEL}`);
  console.log(`Reasoning Display: ${SHOW_REASONING ? 'ENABLED (with <think> tags)' : 'DISABLED'}`);
  console.log(`Thinking Mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
  console.log(`JanitorAI Endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Test: http://localhost:${PORT}/test`);
  console.log(`=================================`);
});
