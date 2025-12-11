/**
 * Content script for bolt.new Voice Assistant
 * Injects UI controls and handles voice interaction
 */

class BoltVoiceAssistant {
  constructor() {
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.websocket = null;
    this.apiKey = null;
    this.agentId = null;
    this.conversationId = null;
    this.mode = null; // 'transcription' or 'agent'
    this.accumulatedTranscript = ''; // Accumulate all transcript segments
    this.currentPartialTranscript = ''; // Track current partial
    this.lastSDKText = ''; // Last clean SDK text for detecting buffer overflow
    this.lastRawSDKText = ''; // Track last raw SDK text for cross-session stripping
    this.fullTranscript = ''; // Client-side full transcript that survives SDK buffer overflow
    this.previousSessionText = ''; // Previous session's final text to strip from new session
    this.isAgentSpeaking = false; // Track if agent is currently speaking (to prevent echo)
    this.audioStream = null; // Store audio stream for pause/resume
    this.processedAudioEvents = new Set(); // Track processed audio event IDs to prevent duplicates
    this.audioQueue = []; // Queue for agent audio chunks
    this.isPlayingAudio = false; // Track if audio is currently playing from queue
    this.currentAudio = null; // Reference to currently playing audio element

    // Define client tools with exact function names matching ElevenLabs configuration
    this.clientTools = {
      improve_prompt: async (params) => {
        return await this.executeImprovePrompt(params);
      },
      create_prompt: async (params) => {
        return await this.executeCreatePrompt(params);
      },
      update_prompt: async (params) => {
        return await this.executeUpdatePrompt(params);
      },
      analyze_ui: async (params) => {
        return await this.executeAnalyzeUI(params);
      },
      suggest_next_steps: (params) => {
        return this.executeSuggestNextSteps(params);
      }
    };

    // Log that clientTools are initialized
    console.log('========================================');
    console.log('🔧 CLIENT TOOLS INITIALIZED!');
    console.log('Available tools:', Object.keys(this.clientTools));
    console.log('========================================');

    this.init();
  }

  async init() {
    console.log('[Bolt Voice Assistant] ========================================');
    console.log('[Bolt Voice Assistant] Initializing on:', window.location.href);
    console.log('[Bolt Voice Assistant] Document ready state:', document.readyState);
    console.log('[Bolt Voice Assistant] Body exists:', !!document.body);

    // Load settings from storage
    await this.loadSettings();

    // Inject UI with multiple attempts to ensure it loads
    const tryInject = () => {
      console.log('[Bolt Voice Assistant] Attempting to inject UI...');
      if (document.body) {
        this.injectUI();
      } else {
        console.warn('[Bolt Voice Assistant] Body not ready, retrying...');
        setTimeout(tryInject, 100);
      }
    };

    // Try immediately and also after delay
    setTimeout(tryInject, 100);
    setTimeout(tryInject, 1000);
    setTimeout(tryInject, 2000);
  }

  async loadSettings() {
    console.log('[Bolt Voice Assistant] 📂 Loading settings from storage...');

    const result = await chrome.storage.sync.get(['elevenLabsApiKey', 'agentId', 'geminiApiKey']);

    this.apiKey = result.elevenLabsApiKey || '';
    this.agentId = result.agentId || '';
    this.geminiApiKey = result.geminiApiKey || '';

    console.log('[Bolt Voice Assistant] ✅ Settings loaded from storage:');
    console.log('[Bolt Voice Assistant]   - API Key:', this.apiKey ? `Present (${this.apiKey.substring(0, 10)}...)` : '❌ MISSING');
    console.log('[Bolt Voice Assistant]   - Agent ID:', this.agentId || '❌ NOT SET');
    console.log('[Bolt Voice Assistant]   - Gemini API Key:', this.geminiApiKey ? `Present (${this.geminiApiKey.substring(0, 10)}...)` : '❌ MISSING');
    console.log('[Bolt Voice Assistant] Raw storage result:', result);

    if (!this.apiKey) {
      console.warn('[Bolt Voice Assistant] ⚠️ No ElevenLabs API key configured. Please configure in settings.');
    }

    if (!this.agentId) {
      console.warn('[Bolt Voice Assistant] ⚠️ No Agent ID configured. Agent mode will not work.');
    }

    if (!this.geminiApiKey) {
      console.warn('[Bolt Voice Assistant] ⚠️ No Gemini API key configured. Prompt improvement features will not work.');
    }
  }

  injectUI() {
    // Don't inject if already exists
    if (document.getElementById('bolt-voice-panel')) {
      console.log('[Bolt Voice Assistant] UI already injected, skipping');
      return;
    }

    console.log('[Bolt Voice Assistant] Injecting floating panel...');

    // Create settings panel (hidden by default)
    // this.createSettingsPanel(); // DISABLED - Use extension popup instead

    // Create draggable floating panel
    const panel = document.createElement('div');
    panel.id = 'bolt-voice-panel';
    panel.style.cssText = `
      position: fixed;
      top: 24px;
      left: 24px;
      z-index: 10000;
      background: rgba(17, 24, 39, 0.95);
      backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
      min-width: 200px;
      cursor: move;
      user-select: none;
    `;

    // Panel header with drag handle
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">🎙️</span>
        <span style="color: white; font-weight: 600; font-size: 14px;">Voice Assistant</span>
      </div>
    `;

    // Buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    // Create compact buttons
    const transcribeBtn = this.createCompactButton('🎤', 'Transcribe', 'transcription', '#667eea', '#764ba2');
    const pixieBtn = this.createCompactButton('🤖', 'Pixie', 'agent', '#10b981', '#059669');

    buttonsContainer.appendChild(pixieBtn);
    buttonsContainer.appendChild(transcribeBtn);

    panel.appendChild(header);
    panel.appendChild(buttonsContainer);

    console.log('[Bolt Voice Assistant] Panel created, appending to body...');
    document.body.appendChild(panel);
    console.log('[Bolt Voice Assistant] Panel appended! Panel element:', panel);
    console.log('[Bolt Voice Assistant] Panel in DOM:', document.getElementById('bolt-voice-panel'));

    // Make panel draggable
    this.makeDraggable(panel);

    // Settings button handler
    const settingsBtn = document.getElementById('bolt-voice-settings-trigger');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        console.log('[Bolt Voice Assistant] Settings button clicked');
        this.showNotification('Click the extension icon in your toolbar to access settings', 'info');
      });
    }

    console.log('[Bolt Voice Assistant] ✅ Floating panel injected successfully!');
    console.log('[Bolt Voice Assistant] ========================================');
  }

  createVoiceButton() {
    const button = document.createElement('button');
    button.id = 'bolt-voice-btn';
    button.type = 'button';
    // Floating action button style
    button.style.cssText = `
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: 3px solid rgba(255, 255, 255, 0.2);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.5), 0 0 0 0 rgba(102, 126, 234, 0.4);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(10px);
    `;
    button.title = 'Transcription Mode (Speech-to-Text)';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 15C13.66 15 15 13.66 15 12V6C15 4.34 13.66 3 12 3C10.34 3 9 4.34 9 6V12C9 13.66 10.34 15 12 15Z" fill="currentColor"/>
        <path d="M17 11C17 13.76 14.76 16 12 16C9.24 16 7 13.76 7 11H5C5 14.53 7.61 17.43 11 17.93V21H13V17.93C16.39 17.43 19 14.53 19 11H17Z" fill="currentColor"/>
      </svg>
    `;

    button.addEventListener('mouseenter', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'scale(1.1) translateY(-2px)';
        button.style.boxShadow = '0 12px 32px rgba(102, 126, 234, 0.7), 0 0 0 4px rgba(102, 126, 234, 0.2)';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 8px 24px rgba(102, 126, 234, 0.5), 0 0 0 0 rgba(102, 126, 234, 0.4)';
      }
    });

    button.addEventListener('click', () => this.toggleRecording('transcription'));

    return button;
  }

  createAgentButton() {
    const button = document.createElement('button');
    button.id = 'bolt-agent-btn';
    button.type = 'button';
    // Floating action button style - green gradient for Pixie
    button.style.cssText = `
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border: 3px solid rgba(255, 255, 255, 0.2);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.5), 0 0 0 0 rgba(16, 185, 129, 0.4);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(10px);
    `;
    button.title = 'Pixie Agent Mode (Talk with AI)';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor"/>
        <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="10" r="1.5" fill="currentColor"/>
        <path d="M12 17.5C14.33 17.5 16.31 16.04 17.11 14H6.89C7.69 16.04 9.67 17.5 12 17.5Z" fill="currentColor"/>
      </svg>
    `;

    button.addEventListener('mouseenter', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'scale(1.1) translateY(-2px)';
        button.style.boxShadow = '0 12px 32px rgba(16, 185, 129, 0.7), 0 0 0 4px rgba(16, 185, 129, 0.2)';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 8px 24px rgba(16, 185, 129, 0.5), 0 0 0 0 rgba(16, 185, 129, 0.4)';
      }
    });

    button.addEventListener('click', () => this.toggleRecording('agent'));

    return button;
  }

  createSettingsButton() {
    const button = document.createElement('button');
    button.id = 'bolt-settings-btn';
    button.type = 'button';
    button.className = 'rounded-full flex items-center justify-center w-8 h-8 bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer';
    button.title = 'Voice Assistant Settings';
    button.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="currentColor"/>
      </svg>
    `;

    button.addEventListener('click', () => this.toggleSettingsPanel());

    return button;
  }

  createCompactButton(icon, label, mode, color1, color2) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = mode === 'agent' ? 'bolt-agent-btn' : 'bolt-voice-btn';
    button.setAttribute('aria-pressed', 'false');
    button.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: linear-gradient(135deg, ${color1} 0%, ${color2} 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      color: white;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      position: relative;
    `;
    button.innerHTML = `
      <span style="font-size: 18px;">${icon}</span>
      <span>${label}</span>
    `;

    button.addEventListener('mouseenter', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'translateY(-1px)';
        button.style.boxShadow = `0 4px 12px rgba(0,0,0,0.3)`;
        button.style.opacity = '0.9';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = `0 2px 8px rgba(0,0,0,0.2)`;
        button.style.opacity = '1';
      }
    });

    button.addEventListener('click', () => this.toggleRecording(mode));

    return button;
  }

  makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + "px";
      element.style.left = (element.offsetLeft - pos1) + "px";
      element.style.bottom = 'auto';
      element.style.right = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  createSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'bolt-voice-settings-panel';
    panel.className = 'bolt-voice-settings-panel';
    panel.innerHTML = `
      <div class="settings-panel-wrapper">
        <button class="close-settings-btn" title="Close">&times;</button>
        <div class="settings-panel-header">
          <span class="settings-icon">⚙️</span>
          <h3>Voice Assistant Settings</h3>
        </div>
      </div>
      <div class="settings-panel-content">
        <div class="settings-field">
          <label for="api-key-input">
            <strong>ElevenLabs API Key</strong>
            <span class="field-hint">Required for voice transcription</span>
          </label>
          <div class="input-group">
            <input
              type="password"
              id="api-key-input"
              placeholder="sk_..."
              value="${this.apiKey || ''}"
            />
            <button class="toggle-visibility-btn" title="Show/Hide">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="settings-field">
          <label for="agent-id-input">
            <strong>Agent ID</strong>
            <span class="field-hint">Optional - Leave empty to use default</span>
          </label>
          <input
            type="text"
            id="agent-id-input"
            placeholder="agent_..."
            value="${this.agentId || ''}"
          />
        </div>

        <div class="settings-divider"></div>

        <div class="settings-field">
          <label for="gemini-api-key-input">
            <strong>Google Gemini API Key</strong>
            <span class="field-hint">Required for prompt improvement features</span>
          </label>
          <div class="input-group">
            <input
              type="password"
              id="gemini-api-key-input"
              placeholder="AIza..."
              value="${this.geminiApiKey || ''}"
            />
            <button class="toggle-gemini-visibility-btn" title="Show/Hide">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="settings-actions">
          <button class="btn-primary" id="save-settings-btn">
            <span class="btn-icon">💾</span>
            <span>Save Settings</span>
          </button>
          <button class="btn-secondary" id="test-connection-btn">
            <span class="btn-icon">🔌</span>
            <span>Test Connection</span>
          </button>
        </div>

        <div class="settings-status" id="settings-status"></div>

        <div class="settings-info">
          <div class="info-section">
            <p class="info-title">📡 Get your API keys:</p>
            <div class="info-links">
              <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" class="info-link">
                <span>ElevenLabs</span>
                <span class="link-arrow">→</span>
              </a>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" class="info-link">
                <span>Google AI Studio</span>
                <span class="link-arrow">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Add event listeners
    panel.querySelector('.close-settings-btn').addEventListener('click', () => {
      this.toggleSettingsPanel();
    });

    panel.querySelector('.toggle-visibility-btn').addEventListener('click', (e) => {
      const input = panel.querySelector('#api-key-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    panel.querySelector('.toggle-gemini-visibility-btn').addEventListener('click', (e) => {
      const input = panel.querySelector('#gemini-api-key-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    panel.querySelector('#save-settings-btn').addEventListener('click', () => {
      this.saveSettings();
    });

    panel.querySelector('#test-connection-btn').addEventListener('click', () => {
      this.testConnection();
    });

    // Close panel when clicking outside
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        this.toggleSettingsPanel();
      }
    });
  }

  toggleSettingsPanel() {
    const panel = document.getElementById('bolt-voice-settings-panel');
    if (panel) {
      panel.classList.toggle('show');

      // If showing and no API key, highlight the input
      if (panel.classList.contains('show') && !this.apiKey) {
        const input = panel.querySelector('#api-key-input');
        input.focus();
      }
    }
  }

  async saveSettings() {
    const apiKeyInput = document.getElementById('api-key-input');
    const agentIdInput = document.getElementById('agent-id-input');
    const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
    const statusDiv = document.getElementById('settings-status');

    const apiKey = apiKeyInput.value.trim();
    const agentId = agentIdInput.value.trim();
    const geminiApiKey = geminiApiKeyInput.value.trim();

    console.log('[Bolt Voice Assistant] 💾 Saving settings...');
    console.log('[Bolt Voice Assistant] API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'EMPTY');
    console.log('[Bolt Voice Assistant] Agent ID:', agentId || 'EMPTY');
    console.log('[Bolt Voice Assistant] Gemini API Key:', geminiApiKey ? `${geminiApiKey.substring(0, 10)}...` : 'EMPTY');

    if (!apiKey) {
      this.showSettingsStatus('ElevenLabs API Key is required', 'error');
      return;
    }

    if (!geminiApiKey) {
      this.showSettingsStatus('Gemini API Key is required', 'error');
      return;
    }

    try {
      // Save to Chrome sync storage
      const settingsToSave = {
        elevenLabsApiKey: apiKey,
        agentId: agentId || '',  // Save empty string instead of null
        geminiApiKey: geminiApiKey
      };

      console.log('[Bolt Voice Assistant] Saving to storage:', {
        hasApiKey: !!apiKey,
        agentId: agentId || '(empty)',
        hasGeminiApiKey: !!geminiApiKey
      });

      await chrome.storage.sync.set(settingsToSave);

      // Update instance variables
      this.apiKey = apiKey;
      this.agentId = agentId || '';  // Keep as empty string, not null
      this.geminiApiKey = geminiApiKey;

      console.log('[Bolt Voice Assistant] ✅ Settings saved successfully!');
      console.log('[Bolt Voice Assistant] Instance vars updated:', {
        apiKey: !!this.apiKey,
        agentId: this.agentId || '(empty)',
        geminiApiKey: !!this.geminiApiKey
      });

      this.showSettingsStatus('Settings saved successfully! 🎉', 'success');

      // Auto-close after 2 seconds
      setTimeout(() => {
        this.toggleSettingsPanel();
      }, 2000);

    } catch (error) {
      console.error('[Bolt Voice Assistant] Error saving settings:', error);
      this.showSettingsStatus('Failed to save settings', 'error');
    }
  }

  async testConnection() {
    const apiKeyInput = document.getElementById('api-key-input');
    const testBtn = document.getElementById('test-connection-btn');
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      this.showSettingsStatus('Please enter an API key first', 'error');
      return;
    }

    this.showSettingsStatus('Testing connection...', 'info');
    testBtn.disabled = true;

    try {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.showSettingsStatus('✓ Connection successful!', 'success');
      } else {
        const error = await response.json();
        this.showSettingsStatus(`Connection failed: ${error.detail || response.statusText}`, 'error');
      }

    } catch (error) {
      console.error('[Bolt Voice Assistant] Connection test failed:', error);
      this.showSettingsStatus('Connection test failed. Please check your API key.', 'error');
    } finally {
      testBtn.disabled = false;
    }
  }

  showSettingsStatus(message, type) {
    const statusDiv = document.getElementById('settings-status');
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = `settings-status ${type}`;
      statusDiv.style.display = 'block';

      // Auto-hide after 5 seconds for success messages
      if (type === 'success') {
        setTimeout(() => {
          statusDiv.style.display = 'none';
        }, 5000);
      }
    }
  }

  async toggleRecording(mode) {
    console.log('[Bolt Voice Assistant] 🔘 toggleRecording called, mode:', mode, 'isRecording:', this.isRecording);

    if (this.isRecording) {
      console.log('[Bolt Voice Assistant] 🛑 Stopping recording...');
      this.stopRecording();
    } else {
      console.log('[Bolt Voice Assistant] ▶️ Starting recording...');
      this.mode = mode; // Set mode before starting
      await this.startRecording();
    }
  }

  async startRecording() {
    console.log('[Bolt Voice Assistant] ========================================');
    console.log('[Bolt Voice Assistant] 🎬 START RECORDING FLOW');
    console.log('[Bolt Voice Assistant] ========================================');
    console.log('[Bolt Voice Assistant] Mode:', this.mode);
    console.log('[Bolt Voice Assistant] API Key:', this.apiKey ? 'Present (' + this.apiKey.substring(0, 10) + '...)' : '❌ MISSING');
    console.log('[Bolt Voice Assistant] Agent ID:', this.agentId ? this.agentId : '❌ NOT SET');
    console.log('[Bolt Voice Assistant] Agent ID type:', typeof this.agentId);
    console.log('[Bolt Voice Assistant] Agent ID length:', this.agentId ? this.agentId.length : 0);
    console.log('[Bolt Voice Assistant] Agent ID truthy:', !!this.agentId);
    console.log('[Bolt Voice Assistant] ========================================');

    // Check requirements based on mode
    if (!this.apiKey) {
      console.error('[Bolt Voice Assistant] ❌❌❌ MISSING API KEY');
      console.error('[Bolt Voice Assistant] Cannot proceed without API key');
      this.showNotification('Please configure your ElevenLabs API key', 'error');
      setTimeout(() => {
        this.toggleSettingsPanel();
      }, 500);
      return;
    }

    if (this.mode === 'agent') {
      console.log('[Bolt Voice Assistant] 🤖 Agent mode selected, checking Agent ID...');
      console.log('[Bolt Voice Assistant] Agent ID value:', `"${this.agentId}"`);
      console.log('[Bolt Voice Assistant] Is empty?:', this.agentId === '');
      console.log('[Bolt Voice Assistant] Is null?:', this.agentId === null);
      console.log('[Bolt Voice Assistant] Is undefined?:', this.agentId === undefined);

      if (!this.agentId || this.agentId.trim() === '') {
        console.error('[Bolt Voice Assistant] ❌❌❌ AGENT MODE REQUIRES AGENT ID');
        console.error('[Bolt Voice Assistant] Agent ID is:', this.agentId);
        this.showNotification('Agent mode requires an Agent ID. Please configure in settings.', 'error');
        setTimeout(() => {
          this.toggleSettingsPanel();
        }, 500);
        return;
      } else {
        console.log('[Bolt Voice Assistant] ✅ Agent ID present:', this.agentId);
      }
    }

    try {
      console.log('[Bolt Voice Assistant] 🎤 Requesting microphone permission...');

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('[Bolt Voice Assistant] ✅ Microphone access granted!');
      console.log('[Bolt Voice Assistant] Stream:', stream);

      // Store the stream so we can control the tracks
      this.audioStream = stream;

      this.isRecording = true;
      this.updateButtonState(true);

      console.log('[Bolt Voice Assistant] 🔌 Initializing WebSocket connection...');

      // Initialize WebSocket connection for Scribe v2 Realtime
      await this.initializeWebSocket();

      // Set up AudioContext for raw PCM capture
      console.log('[Bolt Voice Assistant] 🎼 Setting up AudioContext for PCM capture...');

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.audioSource = this.audioContext.createMediaStreamSource(stream);

      // Use ScriptProcessor for raw PCM capture
      // NOTE: ScriptProcessorNode is deprecated, but AudioWorkletNode requires
      // a separate worklet file which is complex in Chrome extensions.
      // This works reliably for now. Future improvement: migrate to AudioWorklet.
      const bufferSize = 4096;
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.scriptProcessor.onaudioprocess = (event) => {
        // Don't send audio while agent is speaking (prevents echo/feedback loop)
        if (this.isAgentSpeaking) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (PCM 16-bit)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send PCM data
        this.sendAudioChunk(pcmData.buffer);
      };

      this.audioSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      console.log('[Bolt Voice Assistant] ✅ PCM audio capture started');

      // Reset transcript accumulation for new recording session
      this.accumulatedTranscript = '';
      this.currentPartialTranscript = '';
      this.lastSDKText = '';
      this.fullTranscript = '';
      console.log('[Bolt Voice Assistant] 📝 Transcript accumulation reset for new session');

      this.showNotification('Voice assistant activated', 'success');

      // For agent mode, send current page context
      if (this.mode === 'agent') {
        this.sendPageContextToAgent();
      }

      // Screenshot capture is now only triggered by tool call
      // User must say keywords like "take a screenshot" or "analyze my screen"

    } catch (error) {
      console.error('[Bolt Voice Assistant] Error starting recording:', error);
      this.showNotification('Failed to start recording: ' + error.message, 'error');
      this.isRecording = false;
      this.updateButtonState(false);
    }
  }

  stopRecording() {
    console.log('[Bolt Voice Assistant] 🛑 Stopping recording and cleaning up...');

    // CRITICAL: Set isRecording to false FIRST to reject any late transcription messages
    this.isRecording = false;

    // Clean up ScriptProcessor event handler to prevent memory leaks
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null; // Remove event handler
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
      console.log('[Bolt Voice Assistant] 🧹 ScriptProcessor cleaned up');
    }

    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
      console.log('[Bolt Voice Assistant] 🧹 Audio source disconnected');
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      console.log('[Bolt Voice Assistant] 🧹 AudioContext closed');
    }

    // CRITICAL: Stop all MediaStream tracks to release microphone
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => {
        track.stop();
        console.log('[Bolt Voice Assistant] 🎤 Stopped track:', track.kind);
      });
      this.audioStream = null;
      console.log('[Bolt Voice Assistant] 🧹 MediaStream released');
    }

    // Clean up MediaRecorder (if used)
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
      console.log('[Bolt Voice Assistant] 🧹 MediaRecorder stopped');
    }

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
      console.log('[Bolt Voice Assistant] 🧹 WebSocket closed');
    }

    // Save the last raw SDK text so we can strip it from the next session's transcriptions.
    // Scribe v2 server-side text conditioning carries over text across connections.
    if (this.lastRawSDKText) {
      this.previousSessionText = this.lastRawSDKText;
      console.log('[Bolt Voice Assistant] 💾 Saved previous session text for stripping:', this.previousSessionText);
    }

    // IMPORTANT: Reset transcript state to prevent carryover between sessions
    this.accumulatedTranscript = '';
    this.currentPartialTranscript = '';
    this.lastSDKText = '';
    this.fullTranscript = '';
    this.lastRawSDKText = '';
    this.transcriptionReadyShown = false; // Reset notification flag

    // Clear processed tool calls to free memory
    if (this.processedToolCalls) {
      this.processedToolCalls.clear();
      console.log('[Bolt Voice Assistant] 🧹 Cleared processed tool calls');
    }

    // Clear last tool execution tracking
    if (this.lastToolExecution) {
      this.lastToolExecution = {};
      console.log('[Bolt Voice Assistant] 🧹 Cleared tool execution timestamps');
    }

    // Stop currently playing audio immediately
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
      console.log('[Bolt Voice Assistant] 🛑 Stopped currently playing audio');
    }

    // Clear audio queue and revoke URLs
    if (this.audioQueue && this.audioQueue.length > 0) {
      this.audioQueue.forEach(item => URL.revokeObjectURL(item.audioUrl));
      this.audioQueue = [];
      console.log('[Bolt Voice Assistant] 🧹 Cleared audio queue');
    }
    this.isPlayingAudio = false;
    this.isAgentSpeaking = false;

    console.log('[Bolt Voice Assistant] 🧹 Cleared transcript buffers');

    // Send disconnect message to background script (fire and forget, no response expected)
    try {
      chrome.runtime.sendMessage({ type: 'DISCONNECT' });
      console.log('[Bolt Voice Assistant] 📤 Disconnect message sent to background');
    } catch (e) {
      // Ignore errors if message port is already closed
      console.log('[Bolt Voice Assistant] Disconnect message send failed (extension may be reloading)');
    }

    this.updateButtonState(false);
    this.showNotification('Voice assistant deactivated', 'info');

    console.log('[Bolt Voice Assistant] ✅ Cleanup complete - all resources released');
  }

  async initializeWebSocket() {
    console.log('[Bolt Voice Assistant] 📡 Sending INIT_WEBSOCKET message to background...');

    // Send message to background script to get WebSocket connection
    // Background script will handle the actual WebSocket connection due to CORS
    const message = {
      type: 'INIT_WEBSOCKET',
      apiKey: this.apiKey,
      agentId: this.mode === 'agent' ? this.agentId : null,
      mode: this.mode
    };

    console.log('[Bolt Voice Assistant] Message:', {
      ...message,
      apiKey: message.apiKey ? message.apiKey.substring(0, 10) + '...' : 'MISSING'
    });

    chrome.runtime.sendMessage(message, (response) => {
      console.log('[Bolt Voice Assistant] ========================================');
      console.log('[Bolt Voice Assistant] 📬 WebSocket Initialization Response:');
      console.log('[Bolt Voice Assistant] Response:', response);
      console.log('[Bolt Voice Assistant] ========================================');

      if (response && response.error) {
        console.error('[Bolt Voice Assistant] ❌❌❌ WebSocket FAILED ❌❌❌');
        console.error('[Bolt Voice Assistant] Error details:', response.error);
        console.error('[Bolt Voice Assistant] Mode:', this.mode);
        console.error('[Bolt Voice Assistant] Agent ID:', this.agentId);
        console.error('[Bolt Voice Assistant] API Key:', this.apiKey ? 'Present' : 'Missing');
        console.error('[Bolt Voice Assistant] ========================================');

        this.showNotification('Failed to connect: ' + response.error, 'error');
        this.stopRecording();
      } else if (response && response.success) {
        console.log('[Bolt Voice Assistant] ✅✅✅ WebSocket SUCCESS ✅✅✅');
        console.log('[Bolt Voice Assistant] Mode:', this.mode);
        console.log('[Bolt Voice Assistant] Ready to record audio');
        console.log('[Bolt Voice Assistant] ========================================');
      } else {
        console.warn('[Bolt Voice Assistant] ⚠️ Unexpected response format:', response);
      }
    });

    // CRITICAL: Remove any existing listeners first to prevent duplicates
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      console.log('[Bolt Voice Assistant] 🧹 Removed old message listener');
    }

    // Create new listener
    this.messageListener = (message, sender, sendResponse) => {
      console.log('[Bolt Voice Assistant] 📨 Message from background:', message.type);

      switch (message.type) {
        // Legacy manual WebSocket events
        case 'TRANSCRIPTION':
          this.handleTranscription(message.text, message.isFinal);
          break;

        // SDK events for Scribe v2
        case 'PARTIAL_TRANSCRIPT':
          console.log('[Bolt Voice Assistant] 📝 Partial transcript (SDK):', message.text);
          this.handleTranscription(message.text, false);  // false = not final
          break;

        case 'COMMITTED_TRANSCRIPT':
          console.log('[Bolt Voice Assistant] ✅ Committed transcript (SDK):', message.text);
          this.handleTranscription(message.text, true);  // true = final
          // If word timestamps are available, could show word-by-word animation
          if (message.words && message.words.length > 0) {
            console.log('[Bolt Voice Assistant] 📊 Word timestamps:', message.words);
            // Future: Could use message.words for real-time word highlighting
          }
          break;

        case 'TRANSCRIPTION_READY':
          console.log('[Bolt Voice Assistant] ✅ Scribe session ready (SDK)');
          // Only show notification once per session
          if (!this.transcriptionReadyShown) {
            this.showNotification('Transcription ready', 'success');
            this.transcriptionReadyShown = true;
          }
          break;

        case 'CONNECTION_CLOSED':
          console.log('[Bolt Voice Assistant] 🔌 Connection closed (SDK)');
          break;

        case 'AGENT_READY':
          console.log('[Bolt Voice Assistant] ✅ Agent ready:', message.agentId);
          this.showNotification('Pixie is ready to help!', 'success');
          break;

        case 'AGENT_AUDIO':
          this.handleAgentAudio(message.audioBase64, message.eventId, message.audioFormat);
          break;

        case 'AGENT_RESPONSE':
          this.handleAgentResponse(message.text, message.eventId);
          break;

        case 'AGENT_DISCONNECTED':
          console.log('[Bolt Voice Assistant] 🔌 Agent disconnected. Code:', message.code, 'Reason:', message.reason);
          if (this.isRecording && this.mode === 'agent') {
            this.showNotification('Agent connection lost. Stopping...', 'warning');
            this.stopRecording();
          }
          break;

        case 'USER_TRANSCRIPT':
          this.handleUserTranscript(message.text, message.eventId);
          break;

        case 'TOOL_CALL':
          this.handleToolCall(message.toolName, message.toolCallId, message.parameters);
          break;

        case 'ERROR':
          console.error('[Bolt Voice Assistant] Error:', message.message);
          this.showNotification(message.message, 'error');
          break;

        case 'GET_TEXTAREA_CONTENT':
          // SDK version: return textarea content
          const textarea = this.getBoltTextarea();
          const content = textarea ? textarea.value.trim() : '';
          sendResponse({ content: content });
          return true; // Keep channel open for async response

        case 'WRITE_TEXTAREA':
          // SDK version: write to textarea
          const textareaToWrite = this.getBoltTextarea();
          if (textareaToWrite && message.content) {
            this.sendCommandToBolt(message.content, false);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Textarea not found' });
          }
          break;
      }

      sendResponse({ received: true });
    };

    // Register the listener
    chrome.runtime.onMessage.addListener(this.messageListener);
    console.log('[Bolt Voice Assistant] ✅ Message listener registered');
  }

  async sendAudioChunk(audioData) {
    // Handle both ArrayBuffer (from AudioContext) and Blob (from MediaRecorder)
    let arrayBuffer;

    if (audioData instanceof ArrayBuffer) {
      // PCM data from AudioContext - already an ArrayBuffer
      arrayBuffer = audioData;
    } else if (audioData instanceof Blob) {
      // WebM/Opus data from MediaRecorder - convert Blob to ArrayBuffer
      arrayBuffer = await audioData.arrayBuffer();
    } else {
      console.error('[Bolt Voice Assistant] ❌ Unknown audio data type:', audioData);
      return;
    }

    const audioArray = Array.from(new Uint8Array(arrayBuffer));

    // Don't log every chunk to avoid spam, just first and every 10th
    if (!this.chunkCount) this.chunkCount = 0;
    this.chunkCount++;

    if (this.chunkCount === 1 || this.chunkCount % 10 === 0) {
      console.log('[Bolt Voice Assistant] 🎵 Sending audio chunk #' + this.chunkCount + ', size:', audioArray.length, 'bytes');
    }

    try {
      chrome.runtime.sendMessage({
        type: 'AUDIO_CHUNK',
        audio: audioArray
      });
    } catch (error) {
      // Handle extension context invalidated error
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.error('[Bolt Voice Assistant] ⚠️ Extension context invalidated - stopping recording');
        this.stopRecording();
        this.showNotification('Extension was reloaded. Please try again.', 'warning');
      } else {
        console.error('[Bolt Voice Assistant] ❌ Error sending audio chunk:', error);
      }
    }
  }

  handleTranscription(text, isFinal) {
    console.log('[Bolt Voice Assistant] 📝 Transcription received:', {text, isFinal});

    // CRITICAL: Ignore transcriptions that arrive after recording has stopped
    if (!this.isRecording) {
      console.log('[Bolt Voice Assistant] ⚠️ Ignoring transcription - recording already stopped');
      return;
    }

    if (text && text.trim()) {
      // Scribe v2 server-side text conditioning carries over text from previous sessions.
      // Strip the previous session's text prefix from the current transcription.
      let cleanText = text;
      if (this.previousSessionText && cleanText.startsWith(this.previousSessionText)) {
        cleanText = cleanText.substring(this.previousSessionText.length).trimStart();
        console.log('[Bolt Voice Assistant] 🧹 Stripped previous session text prefix.');
      }

      if (cleanText && cleanText.trim()) {
        // Track the latest raw SDK text for stripping on next session
        this.lastRawSDKText = text;

        // Client-side accumulation to handle SDK buffer overflow.
        // The SDK sends accumulated text but resets after ~500 chars,
        // dropping the beginning. We detect this and maintain our own full transcript.
        if (!this.lastSDKText) {
          // First transcription in this session
          this.fullTranscript = cleanText;
        } else if (cleanText.startsWith(this.lastSDKText)) {
          // Normal growth - SDK still accumulating, append the new portion
          this.fullTranscript += cleanText.substring(this.lastSDKText.length);
        } else {
          // SDK buffer overflow or correction.
          // Find how much of the beginning matches (common prefix).
          let commonLen = 0;
          const minLen = Math.min(this.lastSDKText.length, cleanText.length);
          for (let i = 0; i < minLen; i++) {
            if (this.lastSDKText[i] === cleanText[i]) commonLen++;
            else break;
          }

          if (commonLen > this.lastSDKText.length * 0.3) {
            // Significant overlap = correction (SDK revised a word).
            // Replace the changed tail in our full transcript.
            const oldTailLen = this.lastSDKText.length - commonLen;
            this.fullTranscript = this.fullTranscript.substring(0, this.fullTranscript.length - oldTailLen) + cleanText.substring(commonLen);
          } else {
            // Little overlap = buffer overflow. SDK dropped the beginning.
            // Append the new text to our accumulated transcript.
            this.fullTranscript += ' ' + cleanText;
            console.log('[Bolt Voice Assistant] 🔄 SDK buffer overflow detected, appending new chunk');
          }
        }

        this.lastSDKText = cleanText;

        this.sendCommandToBolt(this.fullTranscript, false);
        this.showTranscription(this.fullTranscript);
        console.log('[Bolt Voice Assistant] Current text:', this.fullTranscript);
      }
    }
  }

  handleAgentAudio(audioBase64, eventId, audioFormat) {
    console.log('[Bolt Voice Assistant] ========================================');
    console.log('[Bolt Voice Assistant] 🔊 AGENT AUDIO RESPONSE RECEIVED');
    console.log('[Bolt Voice Assistant] Event ID:', eventId);
    console.log('[Bolt Voice Assistant] Audio format from agent:', audioFormat);
    console.log('[Bolt Voice Assistant] Audio data size:', audioBase64 ? audioBase64.length : 0, 'bytes (base64)');
    console.log('[Bolt Voice Assistant] ========================================');

    // ElevenLabs streams audio in chunks - same event_id can have multiple audio chunks
    // Use audio content hash for true duplicate detection
    const audioHash = audioBase64 ? audioBase64.substring(0, 50) + audioBase64.length : null;

    if (audioHash && this.processedAudioEvents.has(audioHash)) {
      console.log('[Bolt Voice Assistant] ⚠️ DUPLICATE AUDIO CONTENT - Already processed this exact audio data');
      console.log('[Bolt Voice Assistant] Skipping duplicate audio playback');
      return;
    }

    // Mark this audio content as processed
    if (audioHash) {
      this.processedAudioEvents.add(audioHash);
      console.log('[Bolt Voice Assistant] ✅ Audio content marked as processed');

      // Clean up old hashes (keep only last 100 to prevent memory leak)
      if (this.processedAudioEvents.size > 100) {
        const firstHash = this.processedAudioEvents.values().next().value;
        this.processedAudioEvents.delete(firstHash);
      }
    }

    try {
      // Decode base64 audio
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log('[Bolt Voice Assistant] 🎵 Decoded audio:', bytes.length, 'bytes');

      let audioBlob;
      let mimeType;

      // Determine format based on metadata
      if (audioFormat && audioFormat.includes('pcm')) {
        console.log('[Bolt Voice Assistant] 🔧 PCM format detected, converting to WAV...');

        // PCM needs to be wrapped in WAV format for browser playback
        // Extract sample rate from format string (e.g., "pcm_16000" = 16000 Hz)
        const sampleRate = audioFormat.includes('16000') ? 16000 :
                          audioFormat.includes('22050') ? 22050 :
                          audioFormat.includes('24000') ? 24000 :
                          audioFormat.includes('44100') ? 44100 : 16000;

        console.log('[Bolt Voice Assistant] Sample rate:', sampleRate, 'Hz');

        // Convert PCM to WAV
        audioBlob = this.pcmToWav(bytes, sampleRate);
        mimeType = 'audio/wav';
        console.log('[Bolt Voice Assistant] ✅ Converted PCM to WAV');
      } else {
        // Assume MP3 or other supported format
        console.log('[Bolt Voice Assistant] 🎵 Using native format (likely MP3)');
        mimeType = 'audio/mpeg';
        audioBlob = new Blob([bytes], { type: mimeType });
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('[Bolt Voice Assistant] 🎧 Created audio URL, mime type:', mimeType);

      // Add to queue instead of playing immediately
      this.audioQueue.push({ audioUrl, mimeType, blobSize: audioBlob.size });
      console.log('[Bolt Voice Assistant] 📥 Added audio to queue. Queue size:', this.audioQueue.length);

      // Start playing if not already playing
      if (!this.isPlayingAudio) {
        this.playNextAudio();
      }

    } catch (error) {
      console.error('[Bolt Voice Assistant] ❌❌❌ EXCEPTION in handleAgentAudio');
      console.error('[Bolt Voice Assistant] Error:', error);
      console.error('[Bolt Voice Assistant] Stack:', error.stack);
    }
  }

  playNextAudio() {
    // If queue is empty or already playing, do nothing
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      this.isAgentSpeaking = false;
      console.log('[Bolt Voice Assistant] 📭 Audio queue empty, microphone resumed');
      return;
    }

    this.isPlayingAudio = true;
    this.isAgentSpeaking = true;

    const { audioUrl, mimeType, blobSize } = this.audioQueue.shift();
    console.log('[Bolt Voice Assistant] ▶️ Playing audio from queue. Remaining:', this.audioQueue.length);

    const audio = new Audio(audioUrl);
    this.currentAudio = audio; // Store reference for immediate stop capability

    audio.addEventListener('loadedmetadata', () => {
      console.log('[Bolt Voice Assistant] ✅ Audio metadata loaded, duration:', audio.duration, 'seconds');
    });

    audio.addEventListener('playing', () => {
      console.log('[Bolt Voice Assistant] ▶️ Audio is now playing');
      console.log('[Bolt Voice Assistant] 🔇 Microphone input paused (agent is speaking)');
    });

    audio.addEventListener('error', (e) => {
      console.error('[Bolt Voice Assistant] ❌ Audio error:', audio.error?.code, audio.error?.message);
      URL.revokeObjectURL(audioUrl);
      this.currentAudio = null;
      // Continue to next audio
      this.playNextAudio();
    });

    audio.onended = () => {
      console.log('[Bolt Voice Assistant] 🏁 Audio chunk finished');
      URL.revokeObjectURL(audioUrl);
      this.currentAudio = null;
      // Play next audio in queue
      this.playNextAudio();
    };

    audio.play().then(() => {
      console.log('[Bolt Voice Assistant] ✅ Audio playback started');
    }).catch(error => {
      console.error('[Bolt Voice Assistant] ❌ Audio playback failed:', error.message);
      URL.revokeObjectURL(audioUrl);
      this.currentAudio = null;
      // Continue to next audio
      this.playNextAudio();
    });
  }

  // Convert PCM audio data to WAV format
  pcmToWav(pcmData, sampleRate = 16000) {
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format chunk size
    view.setUint16(20, 1, true); // Audio format (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    const dataView = new Uint8Array(buffer, 44);
    dataView.set(pcmData);

    console.log('[Bolt Voice Assistant] WAV created:', bufferSize, 'bytes, sample rate:', sampleRate);

    return new Blob([buffer], { type: 'audio/wav' });
  }

  handleAgentResponse(text, eventId) {
    console.log('[Bolt Voice Assistant] 💬 Agent text response:', text);

    if (text && text.trim()) {
      // Show the agent's response in a notification or overlay
      this.showAgentResponse(text);

      // Optionally, send to textarea if it's a prompt suggestion
      // this.sendCommandToBolt(text, false);
    }
  }

  handleUserTranscript(text, eventId) {
    console.log('[Bolt Voice Assistant] 📝 User transcript from agent:', text);

    if (text && text.trim()) {
      // Store the user's actual spoken words with timestamp
      this.lastUserTranscript = {
        text: text.toLowerCase(),
        timestamp: Date.now()
      };

      // Display what the agent heard
      this.showTranscription(text);
    }
  }

  sendCommandToBolt(command, append = false) {
    console.log('[Bolt Voice Assistant] Sending command to bolt.new:', command);

    // Find bolt.new's textarea - try specific selectors for both entry and chat pages
    let input = document.querySelector('textarea[aria-label*="Type your idea"]') ||
                document.querySelector('textarea[aria-label*="How can Bolt help you"]') ||
                document.querySelector('textarea[placeholder*="build"]') ||
                document.querySelector('textarea[class*="bolt-elements"]') ||
                document.querySelector('textarea');

    if (input) {
      // Determine final text to set
      let finalText = command;
      if (append && input.value) {
        finalText = input.value + ' ' + command;
      }

      // Use select-all + insertText to properly replace in React controlled inputs.
      // This mimics real user behavior and works with React's event system.
      input.focus();
      input.select(); // Select all existing text
      document.execCommand('insertText', false, finalText);

      console.log('[Bolt Voice Assistant] Command inserted successfully');
    } else {
      console.warn('[Bolt Voice Assistant] Could not find textarea');
      this.showNotification('Could not find input field to send command', 'warning');
    }
  }

  sendPageContextToAgent() {
    console.log('[Bolt Voice Assistant] 📤 Sending page context to agent...');

    // Find the textarea and get its current content
    const textarea = document.querySelector('textarea[aria-label*="Type your idea"]') ||
                     document.querySelector('textarea[aria-label*="How can Bolt help you"]') ||
                     document.querySelector('textarea[placeholder*="build"]') ||
                     document.querySelector('textarea');

    let contextInfo = {
      page: 'bolt.new',
      url: window.location.href,
      timestamp: new Date().toISOString()
    };

    if (textarea) {
      const currentPrompt = textarea.value.trim();
      contextInfo.currentPrompt = currentPrompt;
      contextInfo.promptLength = currentPrompt.length;
      contextInfo.hasPrompt = currentPrompt.length > 0;

      console.log('[Bolt Voice Assistant] 📝 Current prompt:', currentPrompt ? `"${currentPrompt.substring(0, 100)}..."` : '(empty)');
    } else {
      contextInfo.promptFound = false;
      console.warn('[Bolt Voice Assistant] ⚠️ Textarea not found');
    }

    // Detect which page we're on
    if (window.location.pathname === '/') {
      contextInfo.pageType = 'entry_page';
      contextInfo.description = 'User is on bolt.new entry page where they type initial project ideas';
    } else {
      contextInfo.pageType = 'chat_page';
      contextInfo.description = 'User is in an active bolt.new chat session';
    }

    // Format context as natural text for the agent
    let contextText = `Context: User is on ${contextInfo.description}. `;

    if (contextInfo.hasPrompt) {
      contextText += `Current prompt in textarea: "${contextInfo.currentPrompt}". `;
      contextText += `The user may want help improving this prompt or creating a better version.`;
    } else {
      contextText += `The textarea is currently empty. The user may want help creating a new prompt from scratch.`;
    }

    // Send context to background script which will relay to agent WebSocket
    chrome.runtime.sendMessage({
      type: 'AGENT_CONTEXT',
      context: contextText,
      data: contextInfo
    }, (response) => {
      if (response && response.success) {
        console.log('[Bolt Voice Assistant] ✅ Context sent to agent');
      } else {
        console.warn('[Bolt Voice Assistant] ⚠️ Failed to send context:', response?.error);
      }
    });
  }

  /**
   * Handle tool call from Pixie agent
   */
  async handleToolCall(toolName, toolCallId, parameters) {
    console.log('[Bolt Voice Assistant] 🔧 Tool call requested:', toolName);
    console.log('[Bolt Voice Assistant] 📦 Parameters:', JSON.stringify(parameters, null, 2));

    let result;
    let success = true;

    try {
      // Check if we have this tool function
      if (this.clientTools[toolName]) {
        console.log('[Bolt Voice Assistant] ✅ Found tool function:', toolName);
        console.log('[Bolt Voice Assistant] ⚙️ Executing tool...');
        result = await this.clientTools[toolName](parameters);
        console.log('[Bolt Voice Assistant] ✅ Tool executed successfully!');
        console.log('[Bolt Voice Assistant] 📊 Tool result:', result);
      } else {
        success = false;
        result = `Unknown tool: ${toolName}. Available tools: ${Object.keys(this.clientTools).join(', ')}`;
        console.error('[Bolt Voice Assistant] ❌ Unknown tool:', toolName);
        console.error('[Bolt Voice Assistant] 📋 Available tools:', Object.keys(this.clientTools));
      }

    } catch (error) {
      success = false;
      result = `Error executing ${toolName}: ${error.message}`;
      console.error('[Bolt Voice Assistant] ❌ Tool execution error:', error);
    }

    // Send result back to background script
    console.log('[Bolt Voice Assistant] 📤 Sending tool result back to background...');
    chrome.runtime.sendMessage({
      type: 'TOOL_RESULT',
      toolCallId: toolCallId,
      result: result,
      success: success
    });
    console.log('[Bolt Voice Assistant] ✅ Tool result sent!');
  }

  /**
   * Execute improve_prompt tool - Calls Gemini AI to improve the prompt
   */
  async executeImprovePrompt(parameters) {
    const { user_idea } = parameters;
    console.log('[Bolt Voice Assistant] 🎯 Executing improve_prompt');

    // Show spinner notification immediately
    this.showNotification('⏳ Improving prompt...', 'info', 0); // 0 = no auto-hide

    // ALWAYS read current textarea content, don't trust the parameter
    const textarea = this.getBoltTextarea();
    const actualPrompt = textarea ? textarea.value.trim() : '';

    console.log('[Bolt Voice Assistant] 📝 Actual textarea content:', actualPrompt || '(empty)');

    if (!actualPrompt) {
      this.hideNotification(); // Hide spinner
      return "I don't see any text in the textarea. Could you type a prompt first, then ask me to improve it?";
    }

    // Get Gemini API key from storage
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const geminiApiKey = result.geminiApiKey;

    if (!geminiApiKey) {
      this.hideNotification(); // Hide spinner
      return "Oops! The Gemini API key isn't configured yet. Please set it in the extension settings.";
    }

    try {
      console.log('[Bolt Voice Assistant] 🤖 Calling Gemini AI to improve prompt...');

      // Build the prompt for Gemini
      const systemInstruction = `You are an expert at writing prompts for bolt.new, an AI-powered full-stack web development platform. Your job is to improve user prompts to be more specific, detailed, and effective for building web applications.

IMPORTANT: You must respond ONLY in English, regardless of the input language.

When improving prompts:
- Be structured and detailed in your response, use paragraphs and bullet points to make it easy to read and understand.
- Be specific about technology choices (React, Vue, Node.js, etc.)
- Include clear feature descriptions
- Specify UI/UX requirements
- Add technical details like state management, API endpoints, database structure if relevant
- Describe both the front-end and back-end on what to build and how to build it (bolt.new handles implementation)
- DO NOT say anything like "Here is your prompt improved..." or something like that. Just return the improved prompt.

Return ONLY the improved prompt text in ENGLISH, nothing else.`;

      const userPrompt = `Please improve this bolt.new prompt (respond in ENGLISH only):\n\n"${actualPrompt}"\n\n${user_idea ? `User's additional guidance: ${user_idea}` : ''}`;

      // Call Gemini API to improve the prompt
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [{
            parts: [{ text: userPrompt }]
          }],
          generationConfig: {
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Bolt Voice Assistant] ❌ Gemini API error:', error);
        return `Sorry, I got an error from Gemini: ${error.error?.message || response.statusText}`;
      }

      const data = await response.json();

      // Extract text from Gemini response format
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('[Bolt Voice Assistant] ❌ Unexpected Gemini response format:', data);
        return "Sorry, I got an unexpected response from Gemini. Please try again.";
      }

      let improvedPrompt = data.candidates[0].content.parts[0].text.trim();

      // Remove surrounding quotes if present
      if ((improvedPrompt.startsWith('"') && improvedPrompt.endsWith('"')) ||
          (improvedPrompt.startsWith("'") && improvedPrompt.endsWith("'"))) {
        improvedPrompt = improvedPrompt.slice(1, -1);
      }

      console.log('[Bolt Voice Assistant] ✅ OpenAI returned improved prompt');
      console.log('[Bolt Voice Assistant] 📝 Improved prompt:', improvedPrompt);

      // Write the improved prompt to the textarea
      this.sendCommandToBolt(improvedPrompt, false);

      console.log('[Bolt Voice Assistant] ✅ Improved prompt written to textarea!');

      // Hide spinner and show success
      this.hideNotification();
      this.showNotification('✅ Prompt improved!', 'success');

      // Return a natural, conversational response for the voice agent to speak
      return "Done! I've improved your prompt and updated the textarea. You're ready to go!";

    } catch (error) {
      console.error('[Bolt Voice Assistant] ❌ Error calling Gemini API:', error);
      this.hideNotification(); // Hide spinner on error
      return `Sorry, something went wrong while improving your prompt: ${error.message}`;
    }
  }

  /**
   * Execute create_prompt tool - Creates a prompt from scratch using Gemini AI
   */
  async executeCreatePrompt(parameters) {
    // Support both parameter naming conventions
    const app_idea = parameters.app_idea || parameters.project_type;
    const tech_stack = parameters.tech_stack;
    const features = parameters.features || parameters.key_features;
    const design_style = parameters.design_style;
    const additional_requirements = parameters.additional_requirements;

    console.log('[Bolt Voice Assistant] 🎯 Executing create_prompt');
    console.log('[Bolt Voice Assistant] Full parameters:', JSON.stringify(parameters, null, 2));
    console.log('[Bolt Voice Assistant] App idea:', app_idea);
    console.log('[Bolt Voice Assistant] Tech stack:', tech_stack);
    console.log('[Bolt Voice Assistant] Features:', features);
    console.log('[Bolt Voice Assistant] Design style:', design_style);
    console.log('[Bolt Voice Assistant] Additional requirements:', additional_requirements);

    // Show spinner notification immediately
    this.showNotification('⏳ Creating prompt...', 'info', 0); // 0 = no auto-hide

    if (!app_idea) {
      this.hideNotification();
      return "I need to know what kind of app you want to create. Could you tell me your idea?";
    }

    // Get Gemini API key from storage
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const geminiApiKey = result.geminiApiKey;

    if (!geminiApiKey) {
      this.hideNotification();
      return "Oops! The Gemini API key isn't configured yet. Please set it in the extension settings.";
    }

    try {
      console.log('[Bolt Voice Assistant] 🤖 Calling Gemini AI to create prompt from scratch...');

      // Build the system instruction
      const systemInstruction = `You are an expert at writing prompts for bolt.new, an AI-powered full-stack web development platform. Your job is to create detailed, structured prompts optimized for building web applications.

IMPORTANT: You must respond ONLY in English, regardless of the input language.

When creating prompts:
- Be structured and detailed in your response, use paragraphs and bullet points to make it easy to read and understand.
- Be specific about technology choices (React, Vue, Node.js, etc.)
- Include clear feature descriptions
- Specify UI/UX requirements
- Add technical details like state management, API endpoints, database structure if relevant
- Describe both the front-end and back-end on what to build and how to build it (bolt.new handles implementation)
- DO NOT say anything like "Here is your created prompt..." or something like that. Just return the created prompt. 

Return ONLY the prompt text in ENGLISH, nothing else.`;

      // Build the user message with all context
      let userMessage = `Create a detailed bolt.new prompt (respond in ENGLISH only) for: ${app_idea}`;
      if (tech_stack) {
        userMessage += `\n\nPreferred tech stack: ${tech_stack}`;
      }
      if (features) {
        userMessage += `\n\nKey features needed: ${features}`;
      }
      if (design_style) {
        userMessage += `\n\nDesign style: ${design_style}`;
      }
      if (additional_requirements) {
        userMessage += `\n\nAdditional requirements: ${additional_requirements}`;
      }

      // Call Gemini API to create the prompt
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [{
            parts: [{ text: userMessage }]
          }],
          generationConfig: {
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Bolt Voice Assistant] ❌ Gemini API error:', error);
        return `Sorry, I got an error from Gemini: ${error.error?.message || response.statusText}`;
      }

      const data = await response.json();

      // Extract text from Gemini response format
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('[Bolt Voice Assistant] ❌ Unexpected Gemini response format:', data);
        return "Sorry, I got an unexpected response from Gemini. Please try again.";
      }

      let createdPrompt = data.candidates[0].content.parts[0].text.trim();

      // Remove surrounding quotes if present
      if ((createdPrompt.startsWith('"') && createdPrompt.endsWith('"')) ||
          (createdPrompt.startsWith("'") && createdPrompt.endsWith("'"))) {
        createdPrompt = createdPrompt.slice(1, -1);
      }

      console.log('[Bolt Voice Assistant] ✅ Gemini created new prompt');
      console.log('[Bolt Voice Assistant] 📝 Created prompt:', createdPrompt);

      // Write the created prompt to the textarea
      this.sendCommandToBolt(createdPrompt, false);

      console.log('[Bolt Voice Assistant] ✅ Created prompt written to textarea!');

      // Hide spinner and show success
      this.hideNotification();
      this.showNotification('✅ Prompt created!', 'success');

      // Return a natural, conversational response for the voice agent to speak
      return "Perfect! I've created a detailed prompt for you and written it to the textarea. You're all set to start building!";

    } catch (error) {
      console.error('[Bolt Voice Assistant] ❌ Error calling Gemini API:', error);
      this.hideNotification(); // Hide spinner on error
      return `Sorry, something went wrong while creating your prompt: ${error.message}`;
    }
  }

  /**
   * Execute update_prompt tool - Updates existing prompt based on user feedback
   */
  async executeUpdatePrompt(parameters) {
    const { update_instructions, current_prompt } = parameters;

    console.log('[Bolt Voice Assistant] 🎯 Executing update_prompt');
    console.log('[Bolt Voice Assistant] Update instructions:', update_instructions);
    console.log('[Bolt Voice Assistant] Current prompt parameter:', current_prompt);

    // Show spinner notification immediately
    this.showNotification('⏳ Updating prompt...', 'info', 0); // 0 = no auto-hide

    // ALWAYS read current textarea content, don't trust the parameter
    const textarea = this.getBoltTextarea();
    const actualPrompt = textarea ? textarea.value.trim() : '';

    console.log('[Bolt Voice Assistant] 📝 Actual textarea content:', actualPrompt || '(empty)');

    if (!actualPrompt) {
      this.hideNotification();
      return "I don't see any text in the textarea. Could you type a prompt first, then ask me to update it?";
    }

    if (!update_instructions) {
      this.hideNotification();
      return "I need to know what changes you want to make to the prompt. Could you tell me what to update?";
    }

    // Get Gemini API key from storage
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const geminiApiKey = result.geminiApiKey;

    if (!geminiApiKey) {
      this.hideNotification();
      return "Oops! The Gemini API key isn't configured yet. Please set it in the extension settings.";
    }

    try {
      console.log('[Bolt Voice Assistant] 🤖 Calling Gemini AI to update prompt...');

      // Build the prompt for Gemini
      const systemInstruction = `You are an expert at writing prompts for bolt.new, an AI-powered full-stack web development platform. Your job is to update existing prompts based on user feedback while maintaining the original intent and structure.

IMPORTANT: You must respond ONLY in English, regardless of the input language.

When updating prompts:
- Keep the original structure and intent unless specifically asked to change it
- Apply the user's requested changes precisely
- Maintain or improve specificity about technology choices (React, Vue, Node.js, etc.)
- Keep clear feature descriptions
- Preserve UI/UX requirements unless asked to change them
- Add or modify technical details based on update instructions
- Keep the updated prompt concise but comprehensive
- Focus on what to build, not how to build it (bolt.new handles implementation)
- DO NOT say anything like "Here is your updated prompt..." or something like that. Just return the updated prompt.

Return ONLY the updated prompt text in ENGLISH, nothing else.`;

      const userPrompt = `Please update this bolt.new prompt (respond in ENGLISH only):

Current prompt:
"${actualPrompt}"

Update instructions: ${update_instructions}

Return only the updated prompt, incorporating the requested changes.`;

      // Call Gemini API to update the prompt
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [{
            parts: [{ text: userPrompt }]
          }],
          generationConfig: {
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Bolt Voice Assistant] ❌ Gemini API error:', error);
        this.hideNotification();
        return `Sorry, I got an error from Gemini: ${error.error?.message || response.statusText}`;
      }

      const data = await response.json();

      // Extract text from Gemini response format
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('[Bolt Voice Assistant] ❌ Unexpected Gemini response format:', data);
        this.hideNotification();
        return "Sorry, I got an unexpected response from Gemini. Please try again.";
      }

      let updatedPrompt = data.candidates[0].content.parts[0].text.trim();

      // Remove surrounding quotes if present
      if ((updatedPrompt.startsWith('"') && updatedPrompt.endsWith('"')) ||
          (updatedPrompt.startsWith("'") && updatedPrompt.endsWith("'"))) {
        updatedPrompt = updatedPrompt.slice(1, -1);
      }

      console.log('[Bolt Voice Assistant] ✅ Gemini returned updated prompt');
      console.log('[Bolt Voice Assistant] 📝 Updated prompt:', updatedPrompt);

      // Write the updated prompt to the textarea
      this.sendCommandToBolt(updatedPrompt, false);

      console.log('[Bolt Voice Assistant] ✅ Updated prompt written to textarea!');

      // Hide spinner and show success
      this.hideNotification();
      this.showNotification('✅ Prompt updated!', 'success');

      // Return a natural, conversational response for the voice agent to speak
      return "Done! I've updated your prompt with the changes you requested. The textarea has been updated!";

    } catch (error) {
      console.error('[Bolt Voice Assistant] ❌ Error calling Gemini API:', error);
      this.hideNotification(); // Hide spinner on error
      return `Sorry, something went wrong while updating your prompt: ${error.message}`;
    }
  }

  /**
   * Execute analyze_ui tool - Captures screenshot when user asks
   */
  async executeAnalyzeUI(parameters) {
    const { screenshot_description } = parameters;

    console.log('[Bolt Voice Assistant] 🎯 Executing analyze_ui');
    console.log('[Bolt Voice Assistant] 📸 User requested screenshot analysis');

    // Get page context
    const url = window.location.href;
    const isEntryPage = url.includes('bolt.new') && !url.includes('~/');
    const isChatPage = url.includes('~/');

    // Capture screenshot
    await this.captureScreenContext();

    return {
      page_type: isEntryPage ? 'entry_page' : isChatPage ? 'chat_page' : 'unknown',
      url: url,
      screenshot_description: screenshot_description,
      screenshot_captured: true,
      message: 'Screenshot captured and UI context analyzed successfully'
    };
  }

  /**
   * Execute create_bolt_prompt tool
   */
  executeCreateBoltPrompt(parameters) {
    const { app_description, tech_stack, features } = parameters;

    console.log('[Bolt Voice Assistant] 🎯 Executing create_bolt_prompt');
    console.log('[Bolt Voice Assistant] App description:', app_description);
    console.log('[Bolt Voice Assistant] Tech stack:', tech_stack);
    console.log('[Bolt Voice Assistant] Features:', features);

    // Build the improved prompt
    let improvedPrompt = `Create a ${app_description}`;

    if (tech_stack && tech_stack.length > 0) {
      improvedPrompt += ` using ${tech_stack.join(', ')}`;
    }

    if (features && features.length > 0) {
      improvedPrompt += `.\n\nKey features:\n${features.map(f => `- ${f}`).join('\n')}`;
    }

    // Write the improved prompt to the textarea
    this.sendCommandToBolt(improvedPrompt, false);

    return {
      improved_prompt: improvedPrompt,
      message: 'Prompt created and written to textarea',
      wrote_to_textarea: true
    };
  }

  /**
   * Execute suggest_next_steps tool
   */
  executeSuggestNextSteps(parameters) {
    const { current_state } = parameters;

    console.log('[Bolt Voice Assistant] 🎯 Executing suggest_next_steps');
    console.log('[Bolt Voice Assistant] Current state:', current_state);

    // ALWAYS read current textarea content
    const textarea = this.getBoltTextarea();
    const currentPrompt = textarea ? textarea.value.trim() : '';

    console.log('[Bolt Voice Assistant] 📝 Textarea content for next steps:', currentPrompt || '(empty)');

    return {
      current_prompt: currentPrompt,
      has_content: !!currentPrompt,
      current_state: current_state,
      textarea_found: !!textarea,
      message: currentPrompt
        ? `User has this in textarea: "${currentPrompt.substring(0, 100)}${currentPrompt.length > 100 ? '...' : ''}". Analyzing for next steps.`
        : 'Textarea is empty. User needs guidance on what to build.'
    };
  }

  /**
   * Get the bolt.new textarea element
   */
  getBoltTextarea() {
    return document.querySelector('textarea[aria-label*="Type your idea"]') ||
           document.querySelector('textarea[aria-label*="How can Bolt help you"]') ||
           document.querySelector('textarea[placeholder*="build"]') ||
           document.querySelector('textarea[class*="bolt-elements"]') ||
           document.querySelector('textarea');
  }

  async captureScreenContext() {
    // Capture current screen state and code
    const context = {
      url: window.location.href,
      timestamp: Date.now(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };

    // Try to capture visible code/content
    const codeElements = document.querySelectorAll('pre, code, [class*="editor"]');
    if (codeElements.length > 0) {
      context.code = Array.from(codeElements).map(el => el.textContent).join('\n\n');
    }

    // Capture screenshot via background script
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT',
      context: context
    });
  }

  updateButtonState(isActive) {
    // Update the appropriate button based on mode
    const buttonId = this.mode === 'agent' ? 'bolt-agent-btn' : 'bolt-voice-btn';
    const button = document.getElementById(buttonId);

    if (button) {
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    // Show mode indicator
    if (isActive) {
      const modeText = this.mode === 'agent' ? 'Pixie is listening...' : 'Listening for transcription...';
      this.showNotification(modeText, 'info');
    }
  }

  showNotification(message, type = 'info', duration = 3000) {
    // Remove existing notification if any
    this.hideNotification();

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `bolt-voice-notification ${type}`;
    notification.textContent = message;
    notification.id = 'bolt-voice-active-notification'; // ID for easy removal

    document.body.appendChild(notification);

    // Auto-remove after duration (unless duration is 0 for persistent)
    if (duration > 0) {
      setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
      }, duration);
    }
  }

  hideNotification() {
    // Remove active notification if exists
    const notification = document.getElementById('bolt-voice-active-notification');
    if (notification) {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }
  }

  showTranscription(text) {
    // Show transcription overlay
    let overlay = document.getElementById('bolt-voice-transcription');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bolt-voice-transcription';
      overlay.className = 'bolt-voice-transcription';
      document.body.appendChild(overlay);
    }

    overlay.textContent = `🎤 "${text}"`;
    overlay.classList.add('show');

    setTimeout(() => {
      overlay.classList.remove('show');
    }, 3000);
  }

  showAgentResponse(response) {
    // Show agent's response/recommendations
    let panel = document.getElementById('bolt-voice-agent-panel');

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bolt-voice-agent-panel';
      panel.className = 'bolt-voice-agent-panel';

      const header = document.createElement('div');
      header.className = 'panel-header';
      header.innerHTML = `
        <span>🤖 AI Assistant</span>
        <button class="close-btn">&times;</button>
      `;

      const content = document.createElement('div');
      content.className = 'panel-content';

      panel.appendChild(header);
      panel.appendChild(content);
      document.body.appendChild(panel);

      header.querySelector('.close-btn').addEventListener('click', () => {
        panel.classList.remove('show');
      });
    }

    const content = panel.querySelector('.panel-content');
    content.innerHTML = `<p>${response}</p>`;
    panel.classList.add('show');
  }

  handleAgentToolCall(tool, parameters) {
    console.log('[Bolt Voice Assistant] Agent tool called:', tool, parameters);

    switch (tool) {
      case 'improve_prompt':
        this.handlePromptImprovement(parameters);
        break;
      case 'analyze_ui':
        this.handleUIAnalysis(parameters);
        break;
      case 'create_bolt_prompt':
        this.handleCreateBoltPrompt(parameters);
        break;
      default:
        console.warn('[Bolt Voice Assistant] Unknown tool:', tool);
    }
  }

  handlePromptImprovement(parameters) {
    // Agent has improved the prompt
    if (parameters.improved_prompt) {
      this.showAgentResponse(`I've improved your prompt:\n\n"${parameters.improved_prompt}"\n\nWould you like me to use this?`);
    }
  }

  handleUIAnalysis(parameters) {
    // Agent has analyzed UI
    if (parameters.suggestions) {
      this.showAgentResponse(parameters.suggestions);
    }
  }

  handleCreateBoltPrompt(parameters) {
    // Agent wants to update bolt.new prompt
    if (parameters.improved_prompt) {
      this.sendCommandToBolt(parameters.improved_prompt);
      this.showNotification('Prompt updated!', 'success');
    }
  }
}

// CRITICAL: Singleton pattern to prevent multiple instances
// Check if assistant already exists
if (!window.__boltVoiceAssistantInstance) {
  console.log('[Bolt Voice Assistant] 🚀 Creating NEW instance (singleton)');

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.__boltVoiceAssistantInstance) {
        window.__boltVoiceAssistantInstance = new BoltVoiceAssistant();
        console.log('[Bolt Voice Assistant] ✅ Instance created on DOMContentLoaded');
      }
    });
  } else {
    window.__boltVoiceAssistantInstance = new BoltVoiceAssistant();
    console.log('[Bolt Voice Assistant] ✅ Instance created immediately');
  }
} else {
  console.warn('[Bolt Voice Assistant] ⚠️ Instance already exists! Skipping duplicate initialization');
  console.warn('[Bolt Voice Assistant] Existing instance:', window.__boltVoiceAssistantInstance);
}
