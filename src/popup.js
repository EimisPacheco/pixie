/**
 * Popup script for settings management
 */

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settingsForm');
  const apiKeyInput = document.getElementById('apiKey');
  const agentIdInput = document.getElementById('agentId');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const testBtn = document.getElementById('testBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  await loadSettings();

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
  });

  // Handle test connection
  testBtn.addEventListener('click', async () => {
    await testConnection();
  });

  /**
   * Load settings from storage
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['elevenLabsApiKey', 'agentId', 'geminiApiKey']);

      if (result.elevenLabsApiKey) {
        apiKeyInput.value = result.elevenLabsApiKey;
      }

      if (result.agentId) {
        agentIdInput.value = result.agentId;
      }

      if (result.geminiApiKey) {
        geminiApiKeyInput.value = result.geminiApiKey;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showStatus('Failed to load settings', 'error');
    }
  }

  /**
   * Save settings to storage
   */
  async function saveSettings() {
    const apiKey = apiKeyInput.value.trim();
    const agentId = agentIdInput.value.trim();
    const geminiApiKey = geminiApiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('ElevenLabs API Key is required', 'error');
      return;
    }

    if (!geminiApiKey) {
      showStatus('Gemini API Key is required', 'error');
      return;
    }

    try {
      await chrome.storage.sync.set({
        elevenLabsApiKey: apiKey,
        agentId: agentId || null,
        geminiApiKey: geminiApiKey
      });

      showStatus('Settings saved successfully! 🎉', 'success');

      // Auto-hide success message after 3 seconds
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);

    } catch (error) {
      console.error('Error saving settings:', error);
      showStatus('Failed to save settings', 'error');
    }
  }

  /**
   * Test API connection
   */
  async function testConnection() {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }

    showStatus('Testing connection...', 'info');
    testBtn.disabled = true;

    try {
      // Test the API key by making a simple request
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      });

      if (response.ok) {
        const data = await response.json();
        showStatus(`✓ Connection successful! Welcome, ${data.subscription?.character_count || 'user'}`, 'success');
      } else {
        const error = await response.json();
        showStatus(`Connection failed: ${error.detail || response.statusText}`, 'error');
      }

    } catch (error) {
      console.error('Error testing connection:', error);
      showStatus('Connection test failed. Please check your API key.', 'error');
    } finally {
      testBtn.disabled = false;
    }
  }

  /**
   * Show status message
   */
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
  }
});
