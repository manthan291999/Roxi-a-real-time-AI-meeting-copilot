/**
 * AI Meeting Interpreter — Dynamic Model Discovery
 *
 * Discovers available models from the Groq API on startup to prevent 
 * hardcoded models from causing 404/400 errors when decommissioned.
 * Decoupled implementation following SOLID principles.
 */

const { log } = require('../infrastructure/logger.js');
const { getPool } = require('./groq-key-pool.js');

// Preference list for fast/small models (highest free token usage)
const FAST_MODEL_PREFERENCES = [
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'allam-2-7b',
  'groq/compound-mini',
  'llama3-8b-8192',
  'llama-3.1-8b-instant'
];

// Preference list for smart/deep models
const SMART_MODEL_PREFERENCES = [
  'openai/gpt-oss-120b',
  'groq/compound',
  'llama3-70b-8192',
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile'
];

class ModelDiscovery {
  constructor(apiBaseUrl = 'https://api.groq.com/openai/v1/models') {
    this.apiBaseUrl = apiBaseUrl;
    this.fastModel = null;
    this.smartModel = null;
  }

  async discover() {
    log('info', 'model_discovery', 'starting_discovery');
    const pool = getPool();
    const slot = pool.getActiveSlot();
    
    if (!slot) {
      log('error', 'model_discovery', 'no_active_keys');
      return;
    }

    try {
      const res = await fetch(this.apiBaseUrl, {
        headers: { 'Authorization': `Bearer ${slot.key}` },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch models: ${res.status}`);
      }
      
      const data = await res.json();
      const availableModels = data.data.map(m => m.id);
      
      this.fastModel = FAST_MODEL_PREFERENCES.find(m => availableModels.includes(m)) || availableModels[0];
      this.smartModel = SMART_MODEL_PREFERENCES.find(m => availableModels.includes(m)) || this.fastModel;

      log('info', 'model_discovery', 'discovery_complete', {
        fastModel: this.fastModel,
        smartModel: this.smartModel
      });
      
    } catch (err) {
      log('error', 'model_discovery', 'discovery_failed', { error: err.message });
      // Fallbacks if fetch fails
      this.fastModel = FAST_MODEL_PREFERENCES[0];
      this.smartModel = SMART_MODEL_PREFERENCES[0];
    }
  }

  applyToConfig(agentConfig) {
    if (!this.fastModel || !this.smartModel) {
      log('warn', 'model_discovery', 'models_not_discovered_yet');
      return;
    }
    
    // Apply fast model to fast agents
    ['transcript_cleaner', 'context_manager', 'explanation', 'response'].forEach(agent => {
      if (agentConfig[agent]) {
        agentConfig[agent].model = this.fastModel;
      }
    });

    // Apply smart model to deep agents
    ['technical', 'analyst', 'risk'].forEach(agent => {
      if (agentConfig[agent]) {
        agentConfig[agent].model = this.smartModel;
      }
    });
    
    log('info', 'model_discovery', 'config_mutated_with_discovered_models');
  }
}

// Singleton instance for the application
const discovery = new ModelDiscovery();

module.exports = { ModelDiscovery, discovery };
