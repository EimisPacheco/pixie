# Pixie - AI Voice Assistant for Bolt.new

A Chrome extension that brings AI-powered voice control to [bolt.new](https://bolt.new) using ElevenLabs Conversational AI and Google Gemini.

## Features

- **Voice-to-Code**: Speak naturally to create and modify applications on bolt.new
- **AI-Powered Prompts**: Improve, create, and update prompts using Google Gemini AI
- **Screen Context**: The assistant can see your screen and provide contextual recommendations
- **Real-time Transcription**: Ultra-low latency speech recognition using ElevenLabs Scribe v2
- **Multi-language Support**: Works in 90+ languages with automatic detection

## Prerequisites

- Google Chrome or Chromium-based browser
- [ElevenLabs API Key](https://elevenlabs.io/app/settings/api-keys)
- [ElevenLabs Agent ID](https://elevenlabs.io/app/conversational-ai) (for voice agent mode)
- [Google Gemini API Key](https://aistudio.google.com/app/apikey) (for prompt improvements)

## Installation

### 1. Get API Keys

1. **ElevenLabs**: Sign up at [ElevenLabs](https://elevenlabs.io/) and get your [API Key](https://elevenlabs.io/app/settings/api-keys)
2. **ElevenLabs Agent**: Create a conversational AI agent at [ElevenLabs Console](https://elevenlabs.io/app/conversational-ai) and copy the Agent ID
3. **Google Gemini**: Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 2. Build the Extension

```bash
npm install
npm run build
```

### 3. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select this folder
5. The extension icon should appear in your toolbar

### 4. Configure

1. Click the extension icon in Chrome toolbar
2. Enter your ElevenLabs API Key
3. Enter your ElevenLabs Agent ID
4. Enter your Google Gemini API Key
5. Click "Save Settings"

## Usage

1. Navigate to [bolt.new](https://bolt.new)
2. Look for the microphone button in the top-right area
3. Click to start the voice assistant
4. Speak naturally to:
   - **Improve prompts**: "Make this prompt better"
   - **Create prompts**: "Create a prompt for a todo app"
   - **Get suggestions**: "What should I build next?"
   - **Analyze UI**: "Check my current design"

## Architecture

```
Content Script (content.js)
├── Injects UI controls on bolt.new
├── Handles microphone audio capture
├── Executes client-side tools (Gemini API calls)
└── Displays transcriptions & AI responses

Background Service Worker (background.js)
├── Manages WebSocket connection to ElevenLabs
├── Streams audio to ElevenLabs agent
├── Routes tool calls to content script
└── Handles screenshots for AI context
```

## Client-Side Tools

The extension provides these tools to the ElevenLabs agent:

| Tool | Description |
|------|-------------|
| `improve_prompt` | Enhances the current prompt using Gemini AI |
| `create_prompt` | Creates a new prompt from scratch |
| `update_prompt` | Modifies the existing prompt with specific changes |
| `analyze_ui` | Analyzes the current screen/UI |
| `suggest_next_steps` | Provides recommendations for next actions |

## Project Structure

```
bolt-voice-assistant/
├── manifest.json              # Extension configuration
├── package.json               # Dependencies and build scripts
├── src/
│   ├── background.js         # Service worker (WebSocket, messaging)
│   ├── content.js            # Content script (UI, tools, audio)
│   ├── audio-worklet-processor.js  # Audio processing
│   ├── popup.html            # Settings popup UI
│   ├── popup.js              # Settings logic
│   ├── styles/
│   │   └── content.css       # Styles for injected UI
│   └── icons/                # Extension icons
└── dist/                     # Built files
```

## Development

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch for changes
npm run dev
```

After making changes, reload the extension in `chrome://extensions/`

## Privacy & Security

- Only activates on bolt.new domains
- API keys stored locally in Chrome storage
- Audio is streamed directly to ElevenLabs (not stored)
- Screenshots are sent only for AI context

## License

MIT License

---
