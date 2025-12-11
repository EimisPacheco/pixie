# Voice Commands & Tools

## How Pixie Works

Pixie uses ElevenLabs Conversational AI to understand your voice commands and execute actions. The AI agent handles intent recognition naturally, without keyword matching or traditional programming logic.

## Available Voice Commands

### Prompt Improvement

Speak naturally to improve your prompts:

- "Improve this prompt"
- "Make it better"
- "Enhance my prompt"
- "Polish this"

The AI calls `improve_prompt` which uses Google Gemini to enhance your prompt with:
- Clear structure and requirements
- Technical implementation details
- Design considerations
- Error handling suggestions

### Prompt Creation

Create new prompts from ideas:

- "Create a prompt for a todo app"
- "Build me a new prompt for an e-commerce site"
- "Generate a prompt for a dashboard"

The AI calls `create_prompt` to generate a comprehensive bolt.new prompt based on your description.

### Prompt Updates

Modify existing prompts:

- "Add dark mode to the prompt"
- "Include authentication"
- "Change the color scheme to blue"

The AI calls `update_prompt` to incorporate your requested changes.

### UI Analysis

Get feedback on your current design:

- "Analyze my UI"
- "Check my design"
- "Review the current screen"

The AI uses screen context to provide design recommendations.

### Next Steps

Get suggestions for what to build next:

- "What should I do next?"
- "Suggest improvements"
- "Give me recommendations"

## Tool Implementation

All tools are executed client-side in the browser:

```javascript
clientTools: {
  improve_prompt: async (params) => {
    // Calls Gemini API to improve the prompt
    // Updates bolt.new input field with result
  },
  create_prompt: async (params) => {
    // Calls Gemini API to create new prompt
    // Sets bolt.new input field with result
  },
  update_prompt: async (params) => {
    // Calls Gemini API with update instructions
    // Updates bolt.new input field with result
  }
}
```

## Natural Language Understanding

The ElevenLabs AI agent handles all intent recognition. You don't need to use exact phrases. The AI understands context and can respond to:

- Follow-up questions
- Clarifications
- Conversational requests
- Multiple languages

## Tips for Best Results

1. **Speak clearly** - The AI works best with clear speech
2. **Be specific** - "Add a blue header with navigation" works better than "make it look nice"
3. **Use context** - "Improve the prompt" knows which prompt you mean
4. **Wait for responses** - Let Pixie finish speaking before your next command
