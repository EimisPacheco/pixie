/**
 * AudioWorklet Processor for PCM audio capture
 * This replaces the deprecated ScriptProcessorNode
 * 
 * Processes audio in real-time and converts Float32 samples to Int16 PCM
 */

class PCMAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isProcessing = true;
    
    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this.isProcessing = false;
      } else if (event.data.type === 'start') {
        this.isProcessing = true;
      }
    };
  }

  /**
   * Process audio data
   * @param {Float32Array[][]} inputs - Input audio data
   * @param {Float32Array[][]} outputs - Output audio data (not used)
   * @param {Object} parameters - Audio parameters (not used)
   * @returns {boolean} - Return true to keep processor alive
   */
  process(inputs, outputs, parameters) {
    // Get the first input channel
    const input = inputs[0];
    
    if (!this.isProcessing || !input || input.length === 0) {
      return true; // Keep processor alive but don't process
    }

    const inputChannel = input[0];
    
    if (!inputChannel || inputChannel.length === 0) {
      return true;
    }

    // Convert Float32Array to Int16Array (PCM 16-bit)
    const pcmData = new Int16Array(inputChannel.length);
    
    for (let i = 0; i < inputChannel.length; i++) {
      // Clamp the value between -1 and 1
      const sample = Math.max(-1, Math.min(1, inputChannel[i]));
      // Convert to 16-bit integer
      pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    // Send PCM data to main thread
    this.port.postMessage({
      type: 'audio',
      pcmData: pcmData.buffer
    }, [pcmData.buffer]); // Transfer buffer for performance

    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('pcm-audio-processor', PCMAudioProcessor);

