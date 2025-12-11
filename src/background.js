/**
 * Background service worker for Bolt.new Voice Assistant
 * Handles WebSocket connections, API calls, and screenshot capture
 *
 * HYBRID APPROACH:
 * - Scribe v2 (transcription): Uses @elevenlabs/client SDK
 * - Agent (conversational AI): Uses manual WebSocket (SDK doesn't work in background scripts)
 */

// Import Scribe SDK for transcription mode
import { Scribe, RealtimeEvents } from '@elevenlabs/client';

let websocket = null; // For agent mode (manual WebSocket)
let scribeConnection = null; // For transcription mode (SDK)
let isScribeConnected = false; // Track Scribe WebSocket state
let hasReceivedFirstTranscription = false; // Track first transcription for notification
let toolsRegistered = false; // Prevent duplicate tool registration
let forwardedToolCalls = new Set(); // Prevent duplicate tool call forwarding
let apiKey = null;
let agentId = null;
let conversationId = null;
let currentTabId = null;
let currentMode = null; // 'transcription' or 'agent'
let agentOutputAudioFormat = null; // Store the audio format from agent metadata

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);

  switch (message.type) {
    case 'INIT_WEBSOCKET':
      initializeWebSocket(message.apiKey, message.agentId, sender.tab.id, message.mode)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep channel open for async response

    case 'AUDIO_CHUNK':
      sendAudioChunk(message.audio);
      sendResponse({ success: true });
      break;

    case 'AGENT_CONTEXT':
      sendContextToAgent(message.context, message.data);
      sendResponse({ success: true });
      break;

    case 'CAPTURE_SCREENSHOT':
      captureScreenshot(sender.tab.id, message.context)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'TOOL_RESULT':
      console.log('========================================');
      console.log('[Background] 📥 RECEIVED TOOL_RESULT FROM CONTENT SCRIPT');
      console.log('[Background] Timestamp:', new Date().toISOString());
      console.log('[Background] Tool call ID:', message.toolCallId);
      console.log('[Background] Success:', message.success);
      console.log('[Background] WebSocket connected:', websocket && websocket.readyState === WebSocket.OPEN);
      console.log('[Background] About to forward result to ElevenLabs...');
      console.log('========================================');
      sendToolResult(message.toolCallId, message.result, message.success);
      sendResponse({ success: true });
      break;

    case 'DISCONNECT':
      console.log('========================================');
      console.log('[Background] 🔌 DISCONNECT REQUEST RECEIVED');
      console.log('[Background] Timestamp:', new Date().toISOString());
      console.log('[Background] Current mode:', currentMode);
      console.log('========================================');

      // Close agent WebSocket if active
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log('[Background] Closing agent WebSocket...');
        websocket.close();
        websocket = null;
      }

      // Close Scribe connection if active
      if (scribeConnection && isScribeConnected) {
        console.log('[Background] Closing Scribe connection...');
        try {
          scribeConnection.close();
        } catch (e) {
          console.warn('[Background] Error closing Scribe:', e);
        }
        scribeConnection = null;
        isScribeConnected = false;
      }

      // Reset state
      currentMode = null;
      console.log('[Background] ✅ Disconnect complete');
      sendResponse({ success: true });
      break;

    default:
      console.warn('[Background] Unknown message type:', message.type);
  }
});

/**
 * Initialize WebSocket connection to ElevenLabs API
 */
async function initializeWebSocket(key, agentIdParam, tabId, mode) {
  console.log('[Background] ============================================================');
  console.log('[Background] 🔌 INITIALIZING WEBSOCKET');
  console.log('[Background] Mode:', mode);
  console.log('[Background] API Key:', key ? `Present (${key.substring(0, 10)}...)` : '❌ MISSING');
  console.log('[Background] Agent ID:', agentIdParam || '(none - transcription mode)');
  console.log('[Background] Tab ID:', tabId);
  console.log('[Background] ============================================================');

  apiKey = key;
  agentId = agentIdParam;
  currentTabId = tabId;
  currentMode = mode;

  try {
    if (mode === 'transcription') {
      console.log('[Background] 📝 Starting TRANSCRIPTION mode (Scribe v2)...');
      await initializeScribeWebSocket();
    } else if (mode === 'agent') {
      console.log('[Background] 🤖 Starting AGENT mode (Conversational AI)...');
      await initializeAgentWebSocket();
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
    console.log('[Background] ✅ WebSocket initialization complete!');
  } catch (error) {
    console.error('[Background] ============================================================');
    console.error('[Background] ❌❌❌ WEBSOCKET INITIALIZATION FAILED ❌❌❌');
    console.error('[Background] Error name:', error.name);
    console.error('[Background] Error message:', error.message);
    console.error('[Background] Error stack:', error.stack);
    console.error('[Background] Mode was:', mode);
    console.error('[Background] ============================================================');
    throw error;
  }
}

/**
 * Initialize Scribe v2 using SDK (@elevenlabs/client)
 */
async function initializeScribeWebSocket() {
  console.log('========================================');
  console.log('🎙️ INITIALIZING SCRIBE V2 SDK');
  console.log('========================================');

  // Prevent duplicate initialization
  if (scribeConnection && isScribeConnected) {
    console.log('⚠️ Scribe already connected, skipping initialization');
    return;
  }

  // Close existing connection if any
  if (scribeConnection) {
    console.log('🔄 Closing existing Scribe connection...');
    try {
      scribeConnection.close();
    } catch (e) {
      console.warn('Error closing previous connection:', e);
    }
    scribeConnection = null;
    isScribeConnected = false;
    hasReceivedFirstTranscription = false; // Reset for new session
  }

  try {
    // Step 1: Get single-use token
    console.log('📡 Requesting single-use token from ElevenLabs...');

    const response = await fetch(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get token: ${response.status} - ${error}`);
    }

    const { token } = await response.json();
    console.log('✅ Got single-use token!');

    // Step 2: Connect using SDK
    const connection = Scribe.connect({
      token,
      modelId: "scribe_v2_realtime",
      includeTimestamps: true,
      languageCode: "en" // Force English to prevent random language switching
    });

    scribeConnection = connection;

    // Set up event handlers (matching official SDK documentation)

    // Connection opened
    connection.on(RealtimeEvents.OPEN, () => {
      console.log('Connection opened');
      isScribeConnected = true;
      console.log('✅ WebSocket ready - can now send audio chunks');
      // Don't notify here - wait for first actual transcription
    });

    // Session started
    connection.on(RealtimeEvents.SESSION_STARTED, () => {
      console.log('Session started');
      // Don't send TRANSCRIPTION_READY here - prevents duplicate notifications
    });

    // Partial transcripts
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
      console.log('Partial:', data.text);

      // Send "ready" notification on first transcription only
      if (!hasReceivedFirstTranscription) {
        hasReceivedFirstTranscription = true;
        notifyContentScript('TRANSCRIPTION_READY', {});
      }

      notifyContentScript('TRANSCRIPTION', {
        text: data.text,
        isFinal: false
      });
    });

    // Committed transcripts
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
      console.log('Committed:', data.text);
      notifyContentScript('TRANSCRIPTION', {
        text: data.text,
        isFinal: true
      });
    });

    // Committed transcripts with timestamps
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (data) => {
      console.log('Committed:', data.text);
      console.log('Timestamps:', data.words);
      notifyContentScript('TRANSCRIPTION', {
        text: data.text,
        isFinal: true,
        words: data.words
      });
    });

    // Errors
    connection.on(RealtimeEvents.ERROR, (error) => {
      console.error('Error:', error);
      notifyContentScript('ERROR', {
        message: error.message || error.toString()
      });
    });

    // Connection closed
    connection.on(RealtimeEvents.CLOSE, () => {
      console.log('Connection closed');
      isScribeConnected = false;
      notifyContentScript('CONNECTION_CLOSED', {});
    });

    console.log('✅ SCRIBE SDK INITIALIZED!');

  } catch (error) {
    console.error('❌ Failed to initialize Scribe SDK:', error);
    throw error;
  }
}

/**
 * Initialize Agent WebSocket for conversational AI
 */
async function initializeAgentWebSocket() {
  console.log('[Background] Initializing Agent WebSocket...');
  console.log('[Background] Agent ID:', agentId ? agentId : 'Not provided');

  // Reset tool registration flag for new connection
  toolsRegistered = false;

  if (!agentId) {
    throw new Error('Agent ID is required for agent mode. Please configure it in extension settings.');
  }

  try {
    // Get signed URL for secure WebSocket connection
    console.log('[Background] 📡 Requesting signed URL from ElevenLabs...');
    console.log('[Background] Agent ID:', agentId);
    console.log('[Background] API endpoint:', `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`);

    const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey
      }
    });

    console.log('[Background] 📬 Signed URL Response Status:', signedUrlResponse.status);

    if (!signedUrlResponse.ok) {
      const errorText = await signedUrlResponse.text();
      console.error('[Background] ❌ Signed URL request FAILED');
      console.error('[Background] Status code:', signedUrlResponse.status);
      console.error('[Background] Error response:', errorText);
      console.error('[Background] Agent ID used:', agentId);
      console.error('[Background] API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
      throw new Error(`Failed to get signed URL: ${signedUrlResponse.status} - ${errorText}`);
    }

    const signedUrlData = await signedUrlResponse.json();
    console.log('[Background] 📦 Signed URL Response Data:', JSON.stringify(signedUrlData, null, 2));

    const signedUrl = signedUrlData.signed_url;

    if (!signedUrl) {
      console.error('[Background] ❌ No signed_url in response!');
      console.error('[Background] Response data:', signedUrlData);
      throw new Error('No signed_url in response. Response: ' + JSON.stringify(signedUrlData));
    }

    console.log('[Background] ✅ Got signed URL successfully!');
    console.log('[Background] Signed URL:', signedUrl ? 'Present' : 'Missing');
    console.log('[Background] 🔌 Connecting to agent WebSocket...');

    // Connect to WebSocket using signed URL
    websocket = new WebSocket(signedUrl);

    websocket.onopen = () => {
      console.log('[Background] ✅ Agent WebSocket connected successfully!');
      notifyContentScript('AGENT_READY', { agentId });
    };

    websocket.onmessage = (event) => {
      console.log('[Background] 📨 Agent message received');
      handleAgentMessage(event.data);
    };

    websocket.onerror = (error) => {
      console.error('[Background] ❌ Agent WebSocket error:', error);
      notifyContentScript('ERROR', { message: 'Agent connection error' });
    };

    websocket.onclose = (event) => {
      console.log('========================================');
      console.log('[Background] 🔌🔌🔌 AGENT WEBSOCKET CLOSED 🔌🔌🔌');
      console.log('[Background] Timestamp:', new Date().toISOString());
      console.log('[Background] Close code:', event.code);
      console.log('[Background] Close reason:', event.reason || '(no reason provided)');
      console.log('[Background] Was clean close:', event.wasClean);
      console.log('========================================');

      // Common close codes:
      // 1000 = Normal closure (we initiated)
      // 1001 = Going away
      // 1006 = Abnormal closure (no close frame, connection lost)
      // 1011 = Server error
      if (event.code !== 1000) {
        console.error('[Background] ⚠️ UNEXPECTED WEBSOCKET CLOSURE!');
        console.error('[Background] This was NOT a normal disconnect');
        if (event.code === 1006) {
          console.error('[Background] Code 1006: Connection lost abruptly (network issue or server closed)');
        }
        // Notify content script of unexpected closure
        notifyContentScript('CONNECTION_CLOSED', {
          code: event.code,
          reason: event.reason,
          wasExpected: false
        });
      }

      websocket = null;
      toolsRegistered = false; // Reset for next connection
      forwardedToolCalls.clear(); // Clear forwarded tool calls tracking
      console.log('[Background] 🧹 Cleared forwarded tool calls tracking');
      console.log('========================================');
    };

  } catch (error) {
    console.error('[Background] Failed to initialize agent WebSocket:', error);
    throw error;
  }
}

/**
 * Create a new conversation using ElevenLabs API
 */
async function createConversation() {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/convai/conversation', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: agentId || undefined
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[Background] Conversation created:', data.conversation_id);
    return data.conversation_id;

  } catch (error) {
    console.error('[Background] Error creating conversation:', error);
    throw error;
  }
}

/**
 * Send audio chunk (SDK for Scribe, manual WebSocket for Agent)
 */
function sendAudioChunk(audioData) {
  try {
    // Convert array back to Uint8Array
    const audioBuffer = new Uint8Array(audioData);

    if (currentMode === 'transcription') {
      // SCRIBE MODE: Use SDK's send() method

      // Check if WebSocket is connected before sending
      if (!isScribeConnected) {
        console.warn('[Background] ⚠️ Cannot send audio - WebSocket not connected yet');
        return;
      }

      // Convert to base64 (required by SDK)
      const base64Audio = btoa(String.fromCharCode.apply(null, audioBuffer));

      // Send using SDK method
      scribeConnection.send({
        audioBase64: base64Audio,
        sampleRate: 16000
      });

    } else if (currentMode === 'agent') {
      // AGENT MODE: Use manual WebSocket

      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        console.error('[Background] WebSocket not connected');
        return;
      }

      const base64Audio = btoa(String.fromCharCode.apply(null, audioBuffer));

      // Agent format: user_audio_chunk with base64 audio
      const message = {
        user_audio_chunk: base64Audio
      };

      console.log('[Background] Sending audio chunk (Agent), size:', audioBuffer.length, 'bytes');
      websocket.send(JSON.stringify(message));
    }

  } catch (error) {
    console.error('[Background] Error sending audio chunk:', error);
  }
}

/**
 * Send contextual information to agent
 */
function sendContextToAgent(contextText, contextData) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.error('[Background] WebSocket not connected, cannot send context');
    return;
  }

  if (currentMode !== 'agent') {
    console.log('[Background] Not in agent mode, skipping context send');
    return;
  }

  try {
    console.log('[Background] 📤 Context available for tools:', contextText);
    console.log('[Background] 📊 Context data:', contextData);

    // DO NOT send context as user_message - it causes the agent to respond twice!
    // Instead, the context is stored and will be provided when tools are called.
    // Tools like improve_prompt will read the textarea directly when executed.

    console.log('[Background] ✅ Context ready (not sent as message to avoid double-talk)');

  } catch (error) {
    console.error('[Background] Error preparing context:', error);
  }
}

/**
 * Handle incoming WebSocket messages (deprecated - split into separate handlers)
 */
function handleWebSocketMessage(data) {
  try {
    const message = JSON.parse(data);
    console.log('[Background] WebSocket message:', message);

    switch (message.type) {
      case 'transcription':
        notifyContentScript('TRANSCRIPTION', {
          text: message.text,
          isFinal: message.is_final || false
        });
        break;

      case 'agent_response':
        notifyContentScript('AGENT_RESPONSE', {
          response: message.response
        });
        break;

      case 'error':
        console.error('[Background] WebSocket error message:', message.error);
        notifyContentScript('ERROR', {
          message: message.error
        });
        break;

      default:
        console.log('[Background] Unhandled message type:', message.type);
    }

  } catch (error) {
    console.error('[Background] Error handling WebSocket message:', error);
  }
}

/**
 * Handle tool calls from the agent
 */
function handleToolCall(toolCallEvent) {
  const { tool_name, tool_call_id, parameters } = toolCallEvent;

  console.log('[Background] 🔧 Executing tool:', tool_name);
  console.log('[Background] 📋 Parameters:', parameters);
  console.log('[Background] 🆔 Tool call ID:', tool_call_id);

  // Forward tool call to content script for execution
  notifyContentScript('TOOL_CALL', {
    toolName: tool_name,
    toolCallId: tool_call_id,
    parameters: parameters
  });
}

/**
 * Send tool result back to agent
 */
function sendToolResult(toolCallId, result, success = true) {
  console.log('========================================');
  console.log('[Background] 🔍 CHECKING WEBSOCKET STATE BEFORE SENDING TOOL RESULT');
  console.log('[Background] WebSocket exists:', !!websocket);
  console.log('[Background] WebSocket readyState:', websocket?.readyState);
  console.log('[Background] ReadyState meanings: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED');
  console.log('[Background] Current mode:', currentMode);
  console.log('[Background] Tool call ID:', toolCallId);
  console.log('========================================');

  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.error('========================================');
    console.error('[Background] ❌❌❌ CANNOT SEND TOOL RESULT - WEBSOCKET NOT CONNECTED ❌❌❌');
    console.error('[Background] This means the agent will NOT receive the tool result');
    console.error('[Background] Agent will likely timeout waiting for the result');
    console.error('[Background] WebSocket exists:', !!websocket);
    console.error('[Background] WebSocket readyState:', websocket?.readyState, '(1=OPEN, 3=CLOSED)');
    console.error('[Background] Tool call ID:', toolCallId);
    console.error('[Background] Result preview:', typeof result === 'string' ? result.substring(0, 100) : JSON.stringify(result).substring(0, 100));
    console.error('========================================');
    return;
  }

  try {
    // Use client_tool_response for ElevenLabs client tools
    const message = {
      type: 'client_tool_response',
      tool_call_id: toolCallId,
      result: typeof result === 'string' ? result : JSON.stringify(result)
    };

    console.log('========================================');
    console.log('📤 SENDING TOOL RESULT BACK TO ELEVENLABS');
    console.log('Timestamp:', new Date().toISOString());
    console.log('🆔 Tool call ID:', toolCallId);
    console.log('✅ Success:', success);
    console.log('📦 Result preview:', typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result, null, 2).substring(0, 200));
    console.log('📨 Full message:', JSON.stringify(message, null, 2));
    console.log('========================================');

    websocket.send(JSON.stringify(message));

    console.log('========================================');
    console.log('✅✅✅ TOOL RESULT SENT TO ELEVENLABS! ✅✅✅');
    console.log('Agent should now receive the tool result and respond');
    console.log('========================================');

  } catch (error) {
    console.error('========================================');
    console.error('❌❌❌ ERROR SENDING TOOL RESULT! ❌❌❌');
    console.error('Error:', error);
    console.error('========================================');
  }
}

/**
 * Handle agent WebSocket messages
 */
function handleAgentMessage(data) {
  try {
    const message = JSON.parse(data);

    // LOG EVERY SINGLE MESSAGE FROM ELEVENLABS
    console.log('========================================');
    console.log('📨 RAW MESSAGE FROM ELEVENLABS');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Message type:', message.type || 'UNKNOWN');
    console.log('Full message:', JSON.stringify(message, null, 2));
    console.log('========================================');

    switch (message.type) {
      case 'conversation_initiation_metadata':
        // Connection established, metadata received
        console.log('[Background] ✅ Conversation initiated:', message.conversation_initiation_metadata_event);
        const metadata = message.conversation_initiation_metadata_event;
        console.log('[Background] Conversation ID:', metadata.conversation_id);
        console.log('[Background] Agent output format:', metadata.agent_output_audio_format);
        console.log('[Background] User input format:', metadata.user_input_audio_format);
        conversationId = metadata.conversation_id;
        agentOutputAudioFormat = metadata.agent_output_audio_format; // Store for audio playback
        console.log('[Background] 📝 Stored audio format:', agentOutputAudioFormat);

        // CRITICAL: Register client tools with ElevenLabs (only once per connection)
        if (!toolsRegistered) {
          console.log('========================================');
          console.log('🔧 REGISTERING CLIENT TOOLS WITH ELEVENLABS');
          console.log('Timestamp:', new Date().toISOString());
          console.log('========================================');

          const toolRegistration = {
            type: 'conversation_initiation_client_data',
            custom: {
              client_tools: {
                improve_prompt: {},
                create_prompt: {},
                update_prompt: {},
                analyze_ui: {},
                suggest_next_steps: {}
              }
            }
          };

          console.log('📤 TOOL REGISTRATION MESSAGE:');
          console.log(JSON.stringify(toolRegistration, null, 2));
          console.log('========================================');

          websocket.send(JSON.stringify(toolRegistration));
          toolsRegistered = true; // Mark as registered

          console.log('========================================');
          console.log('✅✅✅ TOOLS REGISTERED SUCCESSFULLY! ✅✅✅');
          console.log('Tools registered:', Object.keys(toolRegistration.custom.client_tools));
          console.log('ElevenLabs agent should now be able to call these tools!');
          console.log('========================================');
        } else {
          console.log('⚠️ Tools already registered, skipping duplicate registration');
        }
        break;

      case 'audio':
        // Agent is speaking - audio response
        console.log('[Background] 🔊 Agent audio response');
        const audioEvent = message.audio_event;
        if (audioEvent && audioEvent.audio_base_64) {
          // Play the audio response - include format information
          console.log('[Background] Sending audio to content script, format:', agentOutputAudioFormat);
          notifyContentScript('AGENT_AUDIO', {
            audioBase64: audioEvent.audio_base_64,
            eventId: audioEvent.event_id,
            audioFormat: agentOutputAudioFormat // Pass format to content script
          });
        }
        break;

      case 'interruption':
        // User interrupted the agent
        console.log('[Background] ⚡ User interruption detected');
        break;

      case 'ping':
        // Heartbeat - respond with pong
        console.log('[Background] 🏓 Ping received, sending pong...');
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'pong', event_id: message.ping_event?.event_id }));
        }
        break;

      case 'agent_response':
        // Text response from agent
        console.log('[Background] 💬 Agent text response:', message.agent_response_event);
        const responseEvent = message.agent_response_event;
        if (responseEvent) {
          notifyContentScript('AGENT_RESPONSE', {
            text: responseEvent.response || responseEvent.text,
            eventId: responseEvent.event_id
          });
        }
        break;

      case 'user_transcript':
        // User's speech was transcribed
        console.log('[Background] 📝 User transcript:', message.user_transcription_event);
        const transcript = message.user_transcription_event;
        if (transcript && transcript.user_transcript) {
          notifyContentScript('USER_TRANSCRIPT', {
            text: transcript.user_transcript,
            eventId: transcript.event_id
          });
        }
        break;

      case 'internal_tentative_agent_response':
        // Agent is thinking/preparing response
        console.log('[Background] 💭 Agent thinking...');
        break;

      case 'tool_call':
        // Agent wants to execute a tool (older format)
        console.log('[Background] 🔧 Tool call received (old format):', message.tool_call_event);
        const toolCallEvent = message.tool_call_event;
        if (toolCallEvent && toolCallEvent.tool_call_id) {
          // Check if already forwarded
          if (forwardedToolCalls.has(toolCallEvent.tool_call_id)) {
            console.warn('[Background] ⚠️ DUPLICATE tool_call - already forwarded, skipping');
            break;
          }
          forwardedToolCalls.add(toolCallEvent.tool_call_id);
          handleToolCall(toolCallEvent);
        }
        break;

      case 'client_tool_call':
        // Client tool call (newer format from ElevenLabs)
        console.log('========================================');
        console.log('🔧🔧🔧 CLIENT TOOL CALL RECEIVED! 🔧🔧🔧');
        console.log('Timestamp:', new Date().toISOString());
        console.log('========================================');

        // CRITICAL: ElevenLabs nests the data in client_tool_call object
        const toolCallData = message.client_tool_call || message;

        console.log('📞 Tool name:', toolCallData.tool_name);
        console.log('🆔 Tool call ID:', toolCallData.tool_call_id);
        console.log('📦 Parameters:', JSON.stringify(toolCallData.parameters, null, 2));
        console.log('📨 Full message:', JSON.stringify(message, null, 2));
        console.log('========================================');

        // CRITICAL: Check if this tool call was already forwarded (prevents double execution)
        if (forwardedToolCalls.has(toolCallData.tool_call_id)) {
          console.warn('[Background] ⚠️ DUPLICATE client_tool_call - already forwarded, skipping');
          console.log('========================================');
          break;
        }

        // Mark as forwarded
        forwardedToolCalls.add(toolCallData.tool_call_id);

        // Forward to content script for execution
        console.log('📤 Forwarding tool call to content script...');
        notifyContentScript('TOOL_CALL', {
          toolName: toolCallData.tool_name,
          toolCallId: toolCallData.tool_call_id,
          parameters: toolCallData.parameters || {}
        });
        console.log('✅ Tool call forwarded to content script!');
        console.log('========================================');
        break;

      case 'knowledge_base_query':
      case 'rag_query':
      case 'retrieval':
        // Knowledge base / RAG query - agent is accessing knowledge base
        console.log('========================================');
        console.log('📚 KNOWLEDGE BASE QUERY DETECTED');
        console.log('Message type:', message.type);
        console.log('Full message:', JSON.stringify(message, null, 2));
        console.log('========================================');
        // These are handled server-side, just log for visibility
        break;

      case 'knowledge_base_response':
      case 'rag_response':
      case 'retrieval_response':
        // Knowledge base response received
        console.log('========================================');
        console.log('📚 KNOWLEDGE BASE RESPONSE RECEIVED');
        console.log('Message type:', message.type);
        console.log('Full message:', JSON.stringify(message, null, 2));
        console.log('========================================');
        break;

      default:
        // Log ALL unhandled message types to catch knowledge base messages
        console.log('========================================');
        console.log('[Background] 🔍 UNHANDLED MESSAGE TYPE');
        console.log('Type:', message.type);
        console.log('Full message:', JSON.stringify(message, null, 2));
        console.log('========================================');
        // If this is a knowledge base related message, it will be logged here
        break;
    }

  } catch (error) {
    console.error('[Background] Error handling agent message:', error, 'Raw data:', data);
  }
}

/**
 * Capture screenshot and send to AI for context
 */
async function captureScreenshot(tabId, context) {
  try {
    // Capture visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 90
    });

    console.log('[Background] Screenshot captured');

    // Convert data URL to base64
    const base64Image = dataUrl.split(',')[1];

    // Send screenshot and context to ElevenLabs agent
    await sendScreenshotContextToAgent({
      screenshot: base64Image,
      context: context
    });

  } catch (error) {
    console.error('[Background] Error capturing screenshot:', error);
    throw error;
  }
}

/**
 * Send screenshot context to AI agent (deprecated - using sendContextToAgent for page context now)
 */
async function sendScreenshotContextToAgent(contextData) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.warn('[Background] WebSocket not connected, cannot send context');
    return;
  }

  try {
    // Send context through WebSocket
    websocket.send(JSON.stringify({
      type: 'context',
      data: {
        screenshot: contextData.screenshot,
        url: contextData.context.url,
        code: contextData.context.code,
        viewport: contextData.context.viewport,
        timestamp: contextData.context.timestamp
      }
    }));

    console.log('[Background] Context sent to agent');

  } catch (error) {
    console.error('[Background] Error sending context:', error);
  }
}

/**
 * Notify content script with a message
 */
function notifyContentScript(type, data) {
  if (!currentTabId) {
    console.warn('[Background] No current tab ID');
    return;
  }

  chrome.tabs.sendMessage(currentTabId, {
    type: type,
    ...data
  }).catch(error => {
    console.error('[Background] Error sending message to content script:', error);
  });
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
    console.log('[Background] Visit bolt.new to use the voice assistant!');
  }
});

/**
 * Clean up on extension unload
 */
self.addEventListener('unload', () => {
  if (websocket) {
    websocket.close();
  }
});
