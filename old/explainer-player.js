/**
 * ExplainerPlayer Web Component
 * A comprehensive animation and drawing web component based on the Python explainer versions
 * Supports SVG drawing, speech, math, markdown, questions, and more
 */

// External dependencies (loaded via CDN)
const ROUGH_JS_URL = 'https://unpkg.com/roughjs@latest/bundled/rough.js';
const ROUGH_NOTATION_URL = 'https://unpkg.com/rough-notation/lib/rough-notation.iife.js';
const MATHJAX_URL = 'https://polyfill.io/v3/polyfill.min.js?features=es6';
const MATHJAX_CONFIG = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';

class ExplainerPlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.commands = [];
    this.processedCommands = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.showSubtitles = false;
    this.questionStats = {
      per_question: {},
      total_tries: 0,
      total_corrects: 0,
      total_correct_on_first_try: 0,
      total_time_on_questions: 0.0
    };
    this.groups = {};
    this.zoomGroup = null;
    this.currentZoomFactor = 1.0;
    this.currentUtterance = null;
    this.speakingCanceled = false;
    this.autoIdCounter = 0;
    this.currentY = 30; // Will be set properly in init method
    this.lineSize = 20;
    this.tabSize = 20;
    this.xMargin = 20;
    this.yMargin = 10;
    
    // Enhanced state management
    this.drawingState = {
      position: { x: 0, y: 0 },
      color: "black",
      line_size: 2,
      fill: "none",
      duration: 1,
      pause: false,
      font_size: "16px",
      font_color: "black",
      font_type: "Arial",
      label: null,
      label_location: "above",
      pen_down: true,
      current_drawing_id: null
    };
    
    // Multi-drawing support
    this.drawings = new Map();
    this.drawingCounter = 0;
    this.currentDrawingId = null;
    
    // Alert system
    this.alertManager = null;
  }

  // Convert mathematical coordinates (0,0 = lower left) to SVG coordinates (0,0 = upper left)
  cartesianToSvgY(y) {
    return parseFloat(this.height) - parseFloat(y);
  }

  static get observedAttributes() {
    return ['width', 'height', 'commands', 'svg-coordinates'];
  }

  get width() { return this.getAttribute('width') || '600'; }
  get height() { return this.getAttribute('height') || '400'; }
  get svgCoordinates() { 
    const attr = this.getAttribute('svg-coordinates');
    return attr === null ? true : attr === 'true';
  }

  connectedCallback() {
    console.log('ExplainerPlayer connected');
    this.init();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'commands' && newValue) {
      this.parseCommands();
    }
  }

  async init() {
    await this.loadDependencies();
    this.createStyles();
    this.createHTML();
    this.setupEventListeners();
    
    // Initialize currentY based on height (in mathematical coordinates, near top)
    this.currentY = parseFloat(this.height) - 30;
    
    // Wait for the next tick to ensure HTML is fully rendered
    await new Promise(resolve => setTimeout(resolve, 0));
    this.parseCommands();
  }

  async loadDependencies() {
    // Load external dependencies
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    try {
      await Promise.all([
        loadScript(ROUGH_JS_URL),
        loadScript(ROUGH_NOTATION_URL),
        loadScript(MATHJAX_URL),
        loadScript(MATHJAX_CONFIG)
      ]);
    } catch (error) {
      console.warn('Some dependencies failed to load:', error);
    }
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css?family=Patrick+Hand|Patrick+Hand+SC');
      
      :host {
        display: block;
        font-family: 'Patrick Hand', cursive;
      }
      
      .explainer-container {
        position: relative;
        width: ${this.width}px;
        height: ${this.height}px;
        border: 2px solid black;
        border-radius: 12px;
        background: white;
        overflow: hidden;
      }
      
      .explainer-svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      
      .explainer-svg text {
        font-family: 'Patrick Hand', cursive;
      }
      
      .controls {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(236, 236, 236, 0.95);
        border-top: 1px solid #999;
        padding: 5px;
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        border-radius: 0 0 12px 12px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .controls.visible {
        opacity: 1;
      }
      
      .controls button {
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
      }
      
      .controls button:hover {
        background: #e0e0e0;
      }
      
      .progress-slider {
        flex: 1;
        min-width: 100px;
      }
      
      .subtitles {
        position: absolute;
        bottom: 50px;
        left: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 8px;
        border-radius: 4px;
        font-size: 14px;
        max-height: 100px;
        overflow-y: auto;
        display: none;
      }
      
      .question-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      
      .question-box {
        background: white;
        border: 2px solid black;
        border-radius: 10px;
        padding: 20px;
        max-width: 400px;
        max-height: 300px;
        overflow-y: auto;
        font-family: inherit;
      }
      
      .question-text {
        margin-bottom: 15px;
        font-weight: bold;
      }
      
      .question-option {
        border: 1px solid #ccc;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .question-option:hover {
        background: #f0f0f0;
      }
      
      .question-feedback {
        text-align: center;
        margin-top: 15px;
        font-weight: bold;
      }
      
      .pointer-circle {
        fill: yellow;
        opacity: 0.5;
        animation: pulse 1s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
      }
      
      .highlighted {
        stroke-width: 4px !important;
        animation: highlight-pulse 0.5s ease-in-out;
      }
      
      @keyframes highlight-pulse {
        0%, 100% { stroke-width: 4px; }
        50% { stroke-width: 6px; }
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  createHTML() {
    const container = document.createElement('div');
    container.className = 'explainer-container';
    
    // SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'explainer-svg');
    svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.id = 'explainer-svg';
    
    // Controls
    const controls = document.createElement('div');
    controls.className = 'controls';
    
    const playPauseBtn = document.createElement('button');
    playPauseBtn.textContent = '▶/⏸';
    playPauseBtn.id = 'play-pause';
    
    const rewindBtn = document.createElement('button');
    rewindBtn.textContent = '⏮';
    rewindBtn.id = 'rewind';
    
    const subtitlesBtn = document.createElement('button');
    subtitlesBtn.textContent = '🄪';
    subtitlesBtn.id = 'subtitles-toggle';
    
    const progressSlider = document.createElement('input');
    progressSlider.type = 'range';
    progressSlider.className = 'progress-slider';
    progressSlider.min = '0';
    progressSlider.max = '0';
    progressSlider.value = '0';
    progressSlider.id = 'progress-slider';
    
    controls.appendChild(playPauseBtn);
    controls.appendChild(rewindBtn);
    controls.appendChild(subtitlesBtn);
    controls.appendChild(progressSlider);
    
    // Subtitles
    const subtitles = document.createElement('div');
    subtitles.className = 'subtitles';
    subtitles.id = 'subtitles';
    
    container.appendChild(svg);
    container.appendChild(controls);
    container.appendChild(subtitles);
    
    this.shadowRoot.appendChild(container);
    
    // Store references
    this.svg = svg;
    this.controls = controls;
    this.subtitles = subtitles;
  }

  setupEventListeners() {
    // Mouse events for showing/hiding controls
    this.addEventListener('mousemove', (e) => {
      const rect = this.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const nearBottom = y >= rect.height - 50;
      
      if (nearBottom || this.isPaused) {
        this.controls.classList.add('visible');
      } else {
        this.controls.classList.remove('visible');
      }
    });

    this.addEventListener('mouseleave', () => {
      if (!this.isPaused) {
        this.controls.classList.remove('visible');
      }
    });

    // Control button events
    this.shadowRoot.getElementById('play-pause').addEventListener('click', () => this.togglePlay());
    this.shadowRoot.getElementById('rewind').addEventListener('click', () => this.rewind());
    this.shadowRoot.getElementById('subtitles-toggle').addEventListener('click', () => this.toggleSubtitles());
    
    // Progress slider events
    const slider = this.shadowRoot.getElementById('progress-slider');
    slider.addEventListener('input', (e) => this.onSliderInput(e));
    slider.addEventListener('change', (e) => this.onSliderChange(e));
  }

  parseCommands() {
    const commandsAttr = this.getAttribute('commands');
    if (commandsAttr) {
      try {
        this.commands = JSON.parse(commandsAttr);
        this.processedCommands = this.translateToComplete(this.commands);
        const slider = this.shadowRoot.getElementById('progress-slider');
        if (slider) {
          slider.max = this.processedCommands.length;
        }
        console.log('Parsed commands:', this.commands);
        console.log('Processed commands:', this.processedCommands);
      } catch (error) {
        console.error('Failed to parse commands:', error);
        this.commands = [];
        this.processedCommands = [];
      }
    } else {
      this.commands = [];
      this.processedCommands = [];
    }
  }

  // Enhanced command translation system
  translateToComplete(commands) {
    const completeCommands = [];
    let autoIdCounter = 1;
    
    // Reset drawing state
    this.drawingState = {
      position: { x: 0, y: 0 },
      color: "black",
      line_size: 2,
      fill: "none",
      duration: 1,
      pause: false,
      font_size: "16px",
      font_color: "black",
      font_type: "Arial",
      label: null,
      label_location: "above",
      pen_down: true,
      current_drawing_id: null
    };
    
    console.log('Translating commands:', commands);
    
    for (const command of commands) {
      if (this.isSimpleCommand(command)) {
        try {
          const complete = this.translateSimpleCommand(command, autoIdCounter++);
          if (complete) {
            console.log('Translated simple command:', command, '→', complete);
            completeCommands.push(complete);
          }
        } catch (error) {
          console.warn(`Skipping invalid command: ${error.message}`);
        }
      } else {
        // Already complete, just add it
        console.log('Keeping complex command:', command);
        completeCommands.push(command);
      }
    }
    
    console.log('Final processed commands:', completeCommands);
    return completeCommands;
  }

  isSimpleCommand(command) {
    if (typeof command !== 'object' || command === null) return false;
    const keys = Object.keys(command);
    if (keys.length !== 1) return false;
    
    const simpleCommands = [
      'position', 'move', 'move_rel', 'pen_up', 'pen_down',
      'color', 'line_size', 'fill', 'duration', 'pause',
      'font_size', 'font_color', 'font_type', 'label', 'label_location',
      'line', 'line_rel', 'line_polar', 'line_to',
      'circle', 'circle_at', 'text', 'text_at',
      'rectangle', 'rectangle_at', 'point', 'arrow', 'arrow_polar', 'arrow_to',
      'math', 'math_at', 'amath', 'amath_at',
      'speak', 'alert', 'alert_success', 'alert_warning', 'alert_error', 'alert_info',
      'alert_top', 'alert_bottom', 'alert_left', 'alert_right', 'alert_center',
      'alert_check', 'alert_cross', 'alert_question', 'alert_exclamation',
      'new_drawing', 'switch_drawing', 'clear_current'
    ];
    
    return simpleCommands.includes(keys[0]);
  }

  isStateCommand(commandType) {
    const stateCommands = [
      'position', 'move', 'move_rel', 'pen_up', 'pen_down',
      'color', 'line_size', 'fill', 'duration', 'pause',
      'font_size', 'font_color', 'font_type', 'label', 'label_location',
      'new_drawing', 'switch_drawing', 'clear_current'
    ];
    return stateCommands.includes(commandType);
  }

  translateSimpleCommand(command, autoIdCounter) {
    const [commandType, value] = Object.entries(command)[0];
    const params = Array.isArray(value) ? value : [value];
    
    console.log('Translating simple command:', commandType, 'with params:', params);
    
    // Handle state-setting commands
    if (this.isStateCommand(commandType)) {
      this.updateDrawingState(commandType, params);
      return null; // No drawing command generated
    }
    
    // Handle drawing commands
    if (this.isDrawingCommand(commandType)) {
      return this.translateDrawingCommand(commandType, params, autoIdCounter);
    }
    
    return null;
  }

  isDrawingCommand(commandType) {
    const drawingCommands = [
      'line', 'line_rel', 'line_polar', 'line_to',
      'circle', 'circle_at', 'text', 'text_at',
      'rectangle', 'rectangle_at', 'point', 'arrow', 'arrow_polar', 'arrow_to',
      'math', 'math_at', 'amath', 'amath_at',
      'speak', 'alert', 'alert_success', 'alert_warning', 'alert_error', 'alert_info',
      'alert_top', 'alert_bottom', 'alert_left', 'alert_right', 'alert_center',
      'alert_check', 'alert_cross', 'alert_question', 'alert_exclamation'
    ];
    return drawingCommands.includes(commandType);
  }

  updateDrawingState(commandType, params) {
    switch (commandType) {
      case 'position':
        this.drawingState.position.x = parseFloat(params[0]);
        this.drawingState.position.y = parseFloat(params[1]);
        break;
      case 'move':
        this.drawingState.position.x = parseFloat(params[0]);
        this.drawingState.position.y = parseFloat(params[1]);
        break;
      case 'move_rel':
        this.drawingState.position.x += parseFloat(params[0]);
        this.drawingState.position.y += parseFloat(params[1]);
        break;
      case 'color':
        this.drawingState.color = params[0];
        break;
      case 'line_size':
        this.drawingState.line_size = parseFloat(params[0]);
        break;
      case 'fill':
        this.drawingState.fill = params[0];
        break;
      case 'duration':
        this.drawingState.duration = parseFloat(params[0]);
        break;
      case 'pause':
        this.drawingState.pause = params[0] === true || params[0] === 'true';
        break;
      case 'font_size':
        this.drawingState.font_size = params[0];
        break;
      case 'font_color':
        this.drawingState.font_color = params[0];
        break;
      case 'font_type':
        this.drawingState.font_type = params[0];
        break;
      case 'label':
        this.drawingState.label = params[0];
        break;
      case 'label_location':
        this.drawingState.label_location = params[0];
        break;
      case 'pen_up':
        this.drawingState.pen_down = false;
        break;
      case 'pen_down':
        this.drawingState.pen_down = true;
        break;
      case 'new_drawing':
        this.handleNewDrawing(params);
        break;
      case 'switch_drawing':
        this.currentDrawingId = params[0];
        break;
      case 'clear_current':
        this.clearCurrentDrawing();
        break;
    }
  }

  translateDrawingCommand(commandType, params, autoIdCounter) {
    console.log('Translating drawing command:', commandType, 'with params:', params);
    const mergedParams = this.mergeWithCurrentState(commandType, params);
    console.log('Merged params:', mergedParams);
    
    switch (commandType) {
      case 'line':
        return this.generateCompleteLine(mergedParams, autoIdCounter);
      case 'line_rel':
        return this.generateCompleteLineRelative(mergedParams, autoIdCounter);
      case 'line_polar':
        return this.generateCompleteLinePolar(mergedParams, autoIdCounter);
      case 'line_to':
        return this.generateCompleteLineTo(mergedParams, autoIdCounter);
      case 'circle':
        return this.generateCompleteCircle(mergedParams, autoIdCounter);
      case 'circle_at':
        return this.generateCompleteCircleAt(mergedParams, autoIdCounter);
      case 'text':
        return this.generateCompleteText(mergedParams, autoIdCounter);
      case 'text_at':
        return this.generateCompleteTextAt(mergedParams, autoIdCounter);
      case 'rectangle':
        return this.generateCompleteRectangle(mergedParams, autoIdCounter);
      case 'rectangle_at':
        return this.generateCompleteRectangleAt(mergedParams, autoIdCounter);
      case 'point':
        return this.generateCompletePoint(mergedParams, autoIdCounter);
      case 'arrow':
        return this.generateCompleteArrow(mergedParams, autoIdCounter);
      case 'arrow_polar':
        return this.generateCompleteArrowPolar(mergedParams, autoIdCounter);
      case 'arrow_to':
        return this.generateCompleteArrowTo(mergedParams, autoIdCounter);
      case 'math':
        return this.generateCompleteMath(mergedParams, autoIdCounter);
      case 'math_at':
        return this.generateCompleteMathAt(mergedParams, autoIdCounter);
      case 'amath':
        return this.generateCompleteAmath(mergedParams, autoIdCounter);
      case 'amath_at':
        return this.generateCompleteAmathAt(mergedParams, autoIdCounter);
      case 'alert':
      case 'alert_success':
      case 'alert_warning':
      case 'alert_error':
      case 'alert_info':
      case 'alert_top':
      case 'alert_bottom':
      case 'alert_left':
      case 'alert_right':
      case 'alert_center':
      case 'alert_check':
      case 'alert_cross':
      case 'alert_question':
      case 'alert_exclamation':
        return this.generateCompleteAlert(commandType, mergedParams, autoIdCounter);
      case 'speak':
        return this.generateCompleteSpeak(mergedParams, autoIdCounter);
      default:
        return null;
    }
  }

  // Helper methods for command generation
  mergeWithCurrentState(commandType, params) {
    const defaults = this.getCommandDefaults(commandType);
    const merged = { ...defaults };
    
    console.log('Merging with defaults:', defaults);
    console.log('Provided params:', params);
    
    // Override with provided parameters
    params.forEach((param, index) => {
      if (param !== undefined && param !== null) {
        const key = this.getParameterKey(commandType, index);
        if (key) {
          merged[key] = param;
          console.log(`Set ${key} = ${param}`);
        } else {
          console.warn(`No key found for param at index ${index}: ${param}`);
        }
      }
    });
    
    console.log('Final merged params:', merged);
    return merged;
  }

  getCommandDefaults(commandType) {
    const baseDefaults = {
      duration: this.drawingState.duration,
      line_size: this.drawingState.line_size,
      color: this.drawingState.color,
      fill: this.drawingState.fill,
      pause: this.drawingState.pause,
      label: this.drawingState.label,
      label_location: this.drawingState.label_location,
      font_size: this.drawingState.font_size,
      font_color: this.drawingState.font_color,
      font_type: this.drawingState.font_type
    };
    
    // Add command-specific defaults
    switch (commandType) {
      case 'line':
      case 'line_rel':
      case 'line_polar':
      case 'line_to':
      case 'arrow':
      case 'arrow_polar':
      case 'arrow_to':
        return {
          ...baseDefaults,
          x1: this.drawingState.position.x,
          y1: this.drawingState.position.y
        };
        
      case 'circle':
      case 'circle_at':
      case 'point':
        return {
          ...baseDefaults,
          cx: this.drawingState.position.x,
          cy: this.drawingState.position.y
        };
        
      case 'text':
      case 'text_at':
      case 'math':
      case 'math_at':
      case 'amath':
      case 'amath_at':
        return {
          ...baseDefaults,
          x: this.drawingState.position.x,
          y: this.drawingState.position.y
        };
        
      case 'rectangle':
      case 'rectangle_at':
        return {
          ...baseDefaults,
          x: this.drawingState.position.x,
          y: this.drawingState.position.y
        };
        
      case 'alert':
      case 'alert_success':
      case 'alert_warning':
      case 'alert_error':
      case 'alert_info':
      case 'alert_top':
      case 'alert_bottom':
      case 'alert_left':
      case 'alert_right':
      case 'alert_center':
      case 'alert_check':
      case 'alert_cross':
      case 'alert_question':
      case 'alert_exclamation':
        return {
          ...baseDefaults,
          x: this.getDrawingCenterX(),
          y: this.getDrawingCenterY(),
          background: "rgba(255, 255, 0, 0.9)"
        };
        
      case 'speak':
        return {
          ...baseDefaults,
          text: '',
          lang: 'en-US',
          rate: 1,
          pitch: 1,
          volume: 1,
          voice: null,
          male: true
        };
        
      default:
        return baseDefaults;
    }
  }

  getParameterKey(commandType, index) {
    const parameterMaps = {
      'line': ['x1', 'y1', 'x2', 'y2', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'line_rel': ['x1', 'y1', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'line_polar': ['degrees', 'length', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'line_to': ['x', 'y', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'circle': ['radius', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'circle_at': ['x', 'y', 'radius', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'text': ['text', 'duration', 'font_size', 'font_color', 'font_type', 'pause', 'label', 'label_location'],
      'text_at': ['x', 'y', 'text', 'duration', 'font_size', 'font_color', 'font_type', 'pause', 'label', 'label_location'],
      'rectangle': ['width', 'height', 'duration', 'line_size', 'color', 'fill', 'pause', 'label', 'label_location'],
      'rectangle_at': ['x', 'y', 'width', 'height', 'duration', 'line_size', 'color', 'fill', 'pause', 'label', 'label_location'],
      'point': ['duration', 'size', 'color', 'pause', 'label', 'label_location'],
      'arrow': ['x1', 'y1', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'arrow_polar': ['degrees', 'length', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'arrow_to': ['x', 'y', 'duration', 'line_size', 'color', 'pause', 'label', 'label_location'],
      'math': ['text', 'duration', 'size', 'color', 'pause', 'label', 'label_location'],
      'math_at': ['x', 'y', 'text', 'duration', 'size', 'color', 'pause', 'label', 'label_location'],
      'amath': ['text', 'duration', 'size', 'color', 'pause', 'label', 'label_location'],
      'amath_at': ['x', 'y', 'text', 'duration', 'size', 'color', 'pause', 'label', 'label_location'],
      'speak': ['text', 'duration', 'lang', 'rate', 'pitch', 'volume', 'voice', 'male'],
      'alert': ['x', 'y', 'text', 'duration', 'background', 'font_size', 'speak'],
      'alert_success': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_warning': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_error': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_info': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_top': ['text', 'duration', 'speak'],
      'alert_bottom': ['text', 'duration', 'speak'],
      'alert_left': ['text', 'duration', 'speak'],
      'alert_right': ['text', 'duration', 'speak'],
      'alert_center': ['text', 'duration', 'speak'],
      'alert_check': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_cross': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_question': ['x', 'y', 'text', 'duration', 'speak'],
      'alert_exclamation': ['x', 'y', 'text', 'duration', 'speak']
    };
    
    const keys = parameterMaps[commandType];
    return keys ? keys[index] : null;
  }

  getDrawingCenterX() {
    return parseFloat(this.width) / 2;
  }

  getDrawingCenterY() {
    return parseFloat(this.height) / 2;
  }

  // Helper method to convert coordinates for simple commands
  // Simple commands always use mathematical coordinates and need conversion to SVG
  convertSimpleCommandCoordinates(x, y) {
    return {
      x: x,
      y: this.cartesianToSvgY(y)
    };
  }

  // Complete command generators
  generateCompleteLine(params, autoIdCounter) {
    const { x1, y1, x2, y2, duration, line_size, color, pause, label, label_location } = params;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords1 = this.convertSimpleCommandCoordinates(x1, y1);
    const coords2 = this.convertSimpleCommandCoordinates(x2, y2);
    
    const command = {
      action: "svg",
      command: "line",
      id: `line_${autoIdCounter}`,
      x1: coords1.x,
      y1: coords1.y,
      x2: coords2.x,
      y2: coords2.y,
      stroke: color,
      "stroke-width": line_size,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteLineRelative(params, autoIdCounter) {
    const { x1, y1, duration, line_size, color, pause, label, label_location } = params;
    
    const startX = this.drawingState.position.x;
    const startY = this.drawingState.position.y;
    const endX = startX + parseFloat(x1);
    const endY = startY + parseFloat(y1);
    
    // Update position
    this.drawingState.position.x = endX;
    this.drawingState.position.y = endY;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords1 = this.convertSimpleCommandCoordinates(startX, startY);
    const coords2 = this.convertSimpleCommandCoordinates(endX, endY);
    
    const command = {
      action: "svg",
      command: "line",
      id: `line_${autoIdCounter}`,
      x1: coords1.x,
      y1: coords1.y,
      x2: coords2.x,
      y2: coords2.y,
      stroke: color,
      "stroke-width": line_size,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteLinePolar(params, autoIdCounter) {
    const { degrees, length, duration, line_size, color, pause, label, label_location } = params;
    
    console.log('Generating line polar with params:', params);
    console.log('Current position:', this.drawingState.position);
    
    // Convert polar to Cartesian
    const radians = (degrees * Math.PI) / 180;
    const dx = length * Math.cos(radians);
    const dy = length * Math.sin(radians);
    
    const x1 = this.drawingState.position.x;
    const y1 = this.drawingState.position.y;
    const x2 = x1 + dx;
    const y2 = y1 + dy;
    
    console.log('Polar calculation:', { degrees, length, radians, dx, dy });
    console.log('Start point:', { x1, y1 });
    console.log('End point:', { x2, y2 });
    
    // Update position
    this.drawingState.position.x = x2;
    this.drawingState.position.y = y2;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords1 = this.convertSimpleCommandCoordinates(x1, y1);
    const coords2 = this.convertSimpleCommandCoordinates(x2, y2);
    
    console.log('Converted coordinates:', { coords1, coords2 });
    console.log('SVG height:', this.height);
    
    const command = {
      action: "svg",
      command: "line",
      id: `line_${autoIdCounter}`,
      x1: coords1.x,
      y1: coords1.y,
      x2: coords2.x,
      y2: coords2.y,
      stroke: color,
      "stroke-width": line_size,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    console.log('Generated command:', command);
    return command;
  }

  generateCompleteLineTo(params, autoIdCounter) {
    const { x, y, duration, line_size, color, pause, label, label_location } = params;
    
    const startX = this.drawingState.position.x;
    const startY = this.drawingState.position.y;
    
    // Update position
    this.drawingState.position.x = parseFloat(x);
    this.drawingState.position.y = parseFloat(y);
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords1 = this.convertSimpleCommandCoordinates(startX, startY);
    const coords2 = this.convertSimpleCommandCoordinates(x, y);
    
    const command = {
      action: "svg",
      command: "line",
      id: `line_${autoIdCounter}`,
      x1: coords1.x,
      y1: coords1.y,
      x2: coords2.x,
      y2: coords2.y,
      stroke: color,
      "stroke-width": line_size,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteCircle(params, autoIdCounter) {
    const { cx, cy, radius, line_size, color, pause, label, label_location } = params;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords = this.convertSimpleCommandCoordinates(cx, cy);
    
    const command = {
      action: "svg",
      command: "circle",
      id: `circle_${autoIdCounter}`,
      cx: coords.x,
      cy: coords.y,
      r: radius,
      stroke: color,
      "stroke-width": line_size,
      fill: "none",
      duration: 1,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteCircleAt(params, autoIdCounter) {
    const { x, y, radius, line_size, color, pause, label, label_location } = params;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords = this.convertSimpleCommandCoordinates(x, y);
    
    const command = {
      action: "svg",
      command: "circle",
      id: `circle_${autoIdCounter}`,
      cx: coords.x,
      cy: coords.y,
      r: radius,
      stroke: color,
      "stroke-width": line_size,
      fill: "none",
      duration: 1,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteText(params, autoIdCounter) {
    const { x, y, text, duration, font_size, font_color, font_type, pause, label, label_location } = params;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords = this.convertSimpleCommandCoordinates(x, y);
    
    const command = {
      action: "svg",
      command: "text",
      id: `text_${autoIdCounter}`,
      x: coords.x,
      y: coords.y,
      text: text,
      "font-size": font_size,
      fill: font_color,
      "font-family": font_type,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteTextAt(params, autoIdCounter) {
    const { x, y, text, duration, font_size, font_color, font_type, pause, label, label_location } = params;
    
    // Simple commands always use mathematical coordinates, convert to SVG
    const coords = this.convertSimpleCommandCoordinates(x, y);
    
    const command = {
      action: "svg",
      command: "text",
      id: `text_${autoIdCounter}`,
      x: coords.x,
      y: coords.y,
      text: text,
      "font-size": font_size,
      fill: font_color,
      "font-family": font_type,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteRectangle(params, autoIdCounter) {
    const { x, y, width, height, duration, line_size, color, fill, pause, label, label_location } = params;
    
    const command = {
      action: "svg",
      command: "rect",
      id: `rect_${autoIdCounter}`,
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      width: width,
      height: height,
      stroke: color,
      "stroke-width": line_size,
      fill: fill,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteRectangleAt(params, autoIdCounter) {
    const { x, y, width, height, duration, line_size, color, fill, pause, label, label_location } = params;
    
    const command = {
      action: "svg",
      command: "rect",
      id: `rect_${autoIdCounter}`,
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      width: width,
      height: height,
      stroke: color,
      "stroke-width": line_size,
      fill: fill,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompletePoint(params, autoIdCounter) {
    const { cx, cy, duration, size, color, pause, label, label_location } = params;
    
    const command = {
      action: "svg",
      command: "circle",
      id: `point_${autoIdCounter}`,
      cx: cx,
      cy: this.svgCoordinates ? cy : this.cartesianToSvgY(cy),
      r: size,
      fill: color,
      stroke: "none",
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteArrow(params, autoIdCounter) {
    const { x1, y1, duration, line_size, color, pause, label, label_location } = params;
    
    // Create arrow path
    const dx = x1 - this.drawingState.position.x;
    const dy = y1 - this.drawingState.position.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    
    const arrowHeadLength = 10;
    const arrowHeadAngle = Math.PI / 6;
    
    const x2 = this.drawingState.position.x + dx;
    const y2 = this.drawingState.position.y + dy;
    const x3 = x2 - arrowHeadLength * Math.cos(angle - arrowHeadAngle);
    const y3 = y2 - arrowHeadLength * Math.sin(angle - arrowHeadAngle);
    const x4 = x2 - arrowHeadLength * Math.cos(angle + arrowHeadAngle);
    const y4 = y2 - arrowHeadLength * Math.sin(angle + arrowHeadAngle);
    
    const pathData = `M${this.drawingState.position.x},${this.drawingState.position.y} L${x2},${y2} M${x2},${y2} L${x3},${y3} M${x2},${y2} L${x4},${y4}`;
    
    // Update position
    this.drawingState.position.x = x2;
    this.drawingState.position.y = y2;
    
    const command = {
      action: "svg",
      command: "path",
      id: `arrow_${autoIdCounter}`,
      d: pathData,
      stroke: color,
      "stroke-width": line_size,
      fill: "none",
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteArrowPolar(params, autoIdCounter) {
    const { degrees, length, duration, line_size, color, pause, label, label_location } = params;
    
    // Convert polar to Cartesian
    const radians = (degrees * Math.PI) / 180;
    const dx = length * Math.cos(radians);
    const dy = length * Math.sin(radians);
    
    const x1 = this.drawingState.position.x;
    const y1 = this.drawingState.position.y;
    const x2 = x1 + dx;
    const y2 = y1 + dy;
    
    // Create arrow path
    const angle = radians;
    const arrowHeadLength = 10;
    const arrowHeadAngle = Math.PI / 6;
    
    const x3 = x2 - arrowHeadLength * Math.cos(angle - arrowHeadAngle);
    const y3 = y2 - arrowHeadLength * Math.sin(angle - arrowHeadAngle);
    const x4 = x2 - arrowHeadLength * Math.cos(angle + arrowHeadAngle);
    const y4 = y2 - arrowHeadLength * Math.sin(angle + arrowHeadAngle);
    
    const pathData = `M${x1},${y1} L${x2},${y2} M${x2},${y2} L${x3},${y3} M${x2},${y2} L${x4},${y4}`;
    
    // Update position
    this.drawingState.position.x = x2;
    this.drawingState.position.y = y2;
    
    const command = {
      action: "svg",
      command: "path",
      id: `arrow_${autoIdCounter}`,
      d: pathData,
      stroke: color,
      "stroke-width": line_size,
      fill: "none",
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteArrowTo(params, autoIdCounter) {
    const { x, y, duration, line_size, color, pause, label, label_location } = params;
    
    const x1 = this.drawingState.position.x;
    const y1 = this.drawingState.position.y;
    const x2 = parseFloat(x);
    const y2 = parseFloat(y);
    
    // Create arrow path
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    
    const arrowHeadLength = 10;
    const arrowHeadAngle = Math.PI / 6;
    
    const x3 = x2 - arrowHeadLength * Math.cos(angle - arrowHeadAngle);
    const y3 = y2 - arrowHeadLength * Math.sin(angle - arrowHeadAngle);
    const x4 = x2 - arrowHeadLength * Math.cos(angle + arrowHeadAngle);
    const y4 = y2 - arrowHeadLength * Math.sin(angle + arrowHeadAngle);
    
    const pathData = `M${x1},${y1} L${x2},${y2} M${x2},${y2} L${x3},${y3} M${x2},${y2} L${x4},${y4}`;
    
    // Update position
    this.drawingState.position.x = x2;
    this.drawingState.position.y = y2;
    
    const command = {
      action: "svg",
      command: "path",
      id: `arrow_${autoIdCounter}`,
      d: pathData,
      stroke: color,
      "stroke-width": line_size,
      fill: "none",
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteMath(params, autoIdCounter) {
    const { x, y, text, duration, size, color, pause, label, label_location } = params;
    
    const command = {
      action: "math",
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      text: text,
      "font-size": size,
      color: color,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteMathAt(params, autoIdCounter) {
    const { x, y, text, duration, size, color, pause, label, label_location } = params;
    
    const command = {
      action: "math",
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      text: text,
      "font-size": size,
      color: color,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteAmath(params, autoIdCounter) {
    const { x, y, text, duration, size, color, pause, label, label_location } = params;
    
    const command = {
      action: "amath",
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      text: text,
      "font-size": size,
      color: color,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteAmathAt(params, autoIdCounter) {
    const { x, y, text, duration, size, color, pause, label, label_location } = params;
    
    const command = {
      action: "amath",
      x: x,
      y: this.svgCoordinates ? y : this.cartesianToSvgY(y),
      text: text,
      "font-size": size,
      color: color,
      duration: duration,
      pause: pause
    };
    
    if (label) {
      command.label = label;
      command.label_location = label_location;
    }
    
    return command;
  }

  generateCompleteSpeak(params, autoIdCounter) {
    const { text, duration, lang, rate, pitch, volume, voice, male } = params;
    
    const command = {
      action: "speak",
      id: `speak_${autoIdCounter}`,
      text: text,
      duration: duration,
      lang: lang,
      rate: rate,
      pitch: pitch,
      volume: volume,
      voice: voice,
      male: male
    };
    
    return command;
  }

  generateCompleteAlert(commandType, params, autoIdCounter) {
    let { x, y, text, duration, background, font_size, speak } = params;
    
    // Handle special alert types
    if (commandType.includes('_top')) {
      x = this.getDrawingCenterX();
      y = 50;
    } else if (commandType.includes('_bottom')) {
      x = this.getDrawingCenterX();
      y = parseFloat(this.height) - 50;
    } else if (commandType.includes('_left')) {
      x = 50;
      y = this.getDrawingCenterY();
    } else if (commandType.includes('_right')) {
      x = parseFloat(this.width) - 50;
      y = this.getDrawingCenterY();
    } else if (commandType.includes('_center')) {
      x = this.getDrawingCenterX();
      y = this.getDrawingCenterY();
    }
    
    // Set background based on alert type
    if (commandType.includes('success')) {
      background = "rgba(0, 255, 0, 0.9)";
    } else if (commandType.includes('warning')) {
      background = "rgba(255, 165, 0, 0.9)";
    } else if (commandType.includes('error')) {
      background = "rgba(255, 0, 0, 0.9)";
    } else if (commandType.includes('info')) {
      background = "rgba(0, 0, 255, 0.9)";
    }
    
    // Add icon based on alert type
    if (commandType.includes('check')) {
      text = `✓ ${text}`;
    } else if (commandType.includes('cross')) {
      text = `✗ ${text}`;
    } else if (commandType.includes('question')) {
      text = `? ${text}`;
    } else if (commandType.includes('exclamation')) {
      text = `! ${text}`;
    }
    
    return {
      action: "alert",
      x: x,
      y: y,
      text: text,
      duration: duration,
      background: background,
      font_size: font_size,
      speak: speak,
      id: `alert_${autoIdCounter}`
    };
  }

  // Multi-drawing support
  handleNewDrawing(params) {
    const [width, height, name, xOffset, yOffset] = params;
    const drawingId = `drawing_${++this.drawingCounter}`;
    
    // Calculate position if not provided
    const finalXOffset = xOffset !== undefined ? xOffset : 20;
    const finalYOffset = yOffset !== undefined ? yOffset : this.getLastTextBottom() + 20;
    const finalHeight = height !== undefined ? height : this.calculateDrawingHeight(finalYOffset, 200);
    
    // Update currentY to account for the drawing area
    this.currentY = finalYOffset + finalHeight + 20; // Move text below the drawing
    
    const drawing = this.createDrawingElement(drawingId, width, finalHeight, name, finalXOffset, finalYOffset);
    this.drawings.set(drawingId, drawing);
    this.currentDrawingId = drawingId;
    this.drawingState.current_drawing_id = drawingId;
    
    // Show the drawing immediately when created
    this.showDrawing(drawingId);
  }

  createDrawingElement(drawingId, width, height, name, xOffset, yOffset) {
    const drawing = document.createElement('div');
    drawing.id = drawingId;
    drawing.className = 'drawing';
    drawing.style.cssText = `
      position: absolute;
      left: ${xOffset}px;
      top: ${yOffset}px;
      width: ${width}px;
      height: ${height}px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      display: none;
    `;
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('class', 'explainer-svg');
    
    drawing.appendChild(svg);
    
    if (this.shadowRoot) {
      const container = this.shadowRoot.querySelector('.explainer-container');
      if (container) {
        container.appendChild(drawing);
      }
    }
    
    return { element: drawing, svg: svg };
  }

  getLastTextBottom() {
    // Return the current Y position where the next text would be placed
    return this.currentY;
  }

  calculateDrawingHeight(startY, contentHeight) {
    // Calculate available height from startY to bottom of container (minus margin)
    const availableHeight = parseFloat(this.height) - startY - 50; // 50px margin from bottom
    const minHeight = 200;
    const maxHeight = Math.min(availableHeight, contentHeight + 100);
    return Math.max(minHeight, maxHeight);
  }

  showDrawing(drawingId) {
    if (this.drawings.has(drawingId)) {
      const drawing = this.drawings.get(drawingId);
      if (drawing.element) {
        drawing.element.style.display = 'block';
      }
    }
  }

  hideDrawing(drawingId) {
    if (this.drawings.has(drawingId)) {
      const drawing = this.drawings.get(drawingId);
      if (drawing.element) {
        drawing.element.style.display = 'none';
      }
    }
  }

  clearCurrentDrawing() {
    if (this.currentDrawingId && this.drawings.has(this.currentDrawingId)) {
      const drawing = this.drawings.get(this.currentDrawingId);
      if (drawing.svg) {
        drawing.svg.innerHTML = '';
      }
    }
  }

  // Alert execution
  async executeAlertCommand(cmd) {
    const alert = this.createAlertElement(
      cmd.x, cmd.y, cmd.text, cmd.duration, cmd.background, cmd.font_size
    );
    
    // Show alert
    this.showAlert(alert, cmd.duration);
    
    // Speak if requested
    if (cmd.speak) {
      await this.speakText({ text: cmd.text, duration: cmd.duration });
    } else {
      // Wait for duration
      await new Promise(resolve => {
        setTimeout(resolve, cmd.duration * 1000);
      });
    }
  }

  createAlertElement(x, y, text, duration, background, font_size) {
    const alert = document.createElement('div');
    alert.className = 'explainer-alert';
    alert.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      background: ${background};
      color: black;
      padding: 10px 15px;
      border-radius: 8px;
      font-size: ${font_size};
      font-weight: bold;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      z-index: 1000;
      max-width: 300px;
      word-wrap: break-word;
      text-align: center;
      transform: translate(-50%, -50%);
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
    `;
    alert.textContent = text;
    
    return alert;
  }

  showAlert(alert, duration) {
    // Add to DOM
    this.shadowRoot.appendChild(alert);
    
    // Fade in
    setTimeout(() => {
      alert.style.opacity = '1';
    }, 10);
    
    // Fade out and remove
    setTimeout(() => {
      alert.style.opacity = '0';
      setTimeout(() => {
        if (alert.parentNode) {
          alert.parentNode.removeChild(alert);
        }
      }, 300);
    }, duration * 1000);
  }

  // Animation and easing functions
  ease(progress, easingType) {
    switch (easingType) {
      case 'ease-in': return progress ** 2;
      case 'ease-out': return 1 - (1 - progress) ** 2;
      case 'ease-in-out': 
        return progress < 0.5 ? 2 * (progress ** 2) : 1 - 2 * ((1 - progress) ** 2);
      default: return progress;
    }
  }

  async animateDraw(element, duration = 0, easing = 'linear') {
    if (duration <= 0) return;
    
    const start = performance.now();
    let length = null;
    
    try {
      length = element.getTotalLength();
    } catch (e) {
      length = null;
    }
    
    if (length !== null) {
      element.setAttribute('stroke-dasharray', length);
      element.setAttribute('stroke-dashoffset', length);
    } else {
      element.style.opacity = '0';
    }
    
    return new Promise((resolve) => {
      const animate = (currentTime) => {
        const elapsed = currentTime - start;
        const rawProgress = Math.min(1, elapsed / (duration * 1000));
        const easedProgress = this.ease(rawProgress, easing);
        
        if (length !== null) {
          const offset = length * (1 - easedProgress);
          element.setAttribute('stroke-dashoffset', offset);
        } else {
          element.style.opacity = easedProgress;
        }
        
        if (rawProgress >= 1) {
          if (length !== null) {
            element.removeAttribute('stroke-dasharray');
            element.removeAttribute('stroke-dashoffset');
          }
          resolve();
        } else {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    });
  }

  async animateMove(element, x, y, duration = 1, easing = 'linear') {
    const start = performance.now();
    const initX = parseFloat(element.getAttribute('x') || 0);
    const initY = parseFloat(element.getAttribute('y') || 0);
    
    return new Promise((resolve) => {
      const animate = (currentTime) => {
        const elapsed = currentTime - start;
        const rawProgress = Math.min(1, elapsed / (duration * 1000));
        const easedProgress = this.ease(rawProgress, easing);
        
        const newX = initX + easedProgress * (x - initX);
        const newY = initY + easedProgress * (y - initY);
        
        element.setAttribute('x', newX);
        element.setAttribute('y', newY);
        
        if (rawProgress >= 1) {
          resolve();
        } else {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    });
  }

  // Speech synthesis
  async speakText(details) {
    const text = details.text || '';
    if (!text) return;
    
    // Cancel any ongoing speech
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    
    this.speakingCanceled = false;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = details.lang || 'en-US';
    utterance.pitch = parseFloat(details.pitch || 1);
    utterance.rate = parseFloat(details.rate || 1);
    utterance.volume = parseFloat(details.volume || 1);
    
    // Voice selection - prioritize English voices
    const voices = window.speechSynthesis.getVoices();
    const male = details.male !== false;
    const voiceName = details.voice;
    
    let chosenVoice = null;
    if (voiceName) {
      chosenVoice = voices.find(v => v.name === voiceName);
    } else {
      // First try to find English voices
      chosenVoice = voices.find(v => 
        v.lang && (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB')) && 
        (male ? v.name.toLowerCase().includes('male') : !v.name.toLowerCase().includes('male'))
      );
      
      // If no English voice found, try any English language
      if (!chosenVoice) {
        chosenVoice = voices.find(v => 
          v.lang && v.lang.startsWith('en') && 
          (male ? v.name.toLowerCase().includes('male') : !v.name.toLowerCase().includes('male'))
        );
      }
      
      // Fallback to any voice
      if (!chosenVoice) {
        chosenVoice = voices[0];
      }
    }
    
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    
    this.currentUtterance = utterance;
    
    // Show subtitles if enabled
    if (this.showSubtitles && this.subtitles) {
      this.subtitles.textContent = text;
      this.subtitles.style.display = 'block';
    }
    
    return new Promise((resolve) => {
      utterance.onend = () => {
        this.currentUtterance = null;
        if (this.subtitles) {
          this.subtitles.style.display = 'none';
        }
        resolve();
      };
      
      utterance.onerror = () => {
        this.currentUtterance = null;
        if (this.subtitles) {
          this.subtitles.style.display = 'none';
        }
        resolve();
      };
      
      window.speechSynthesis.speak(utterance);
    });
  }

  // SVG command execution
  async executeSvgCommand(cmd) {
    const command = cmd.command?.toLowerCase();
    const duration = parseFloat(cmd.duration || 0);
    const easing = cmd.easing || 'linear';
    
    // Handle special commands
    if (command === 'clear') {
      this.svg.innerHTML = '';
      this.groups = {};
      this.zoomGroup = null;
      this.currentZoomFactor = 1.0;
      this.currentY = parseFloat(this.height) - this.yMargin;
      return;
    }
    
    if (command === 'new_page') {
      const scrollUp = cmd.scroll_up;
      const title = cmd.title;
      
      if (scrollUp) {
        // Animate existing content upward
        const tempGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        while (this.svg.firstChild) {
          tempGroup.appendChild(this.svg.firstChild);
        }
        this.svg.appendChild(tempGroup);
        
        const animDuration = duration > 0 ? duration : 1;
        const offset = parseFloat(this.height);
        
        await this.animateMove(tempGroup, 0, -offset, animDuration, easing);
      }
      
      // Clear and reset
      this.svg.innerHTML = '';
      this.groups = {};
      this.zoomGroup = null;
      this.currentZoomFactor = 1.0;
      this.currentY = parseFloat(this.height) - this.yMargin;
      
      // Add title if provided
      if (title) {
        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', parseFloat(this.width) / 2);
        titleText.setAttribute('y', '30');
        titleText.setAttribute('text-anchor', 'middle');
        titleText.style.fontSize = '24px';
        titleText.style.fontFamily = 'Patrick Hand, cursive';
        titleText.style.fill = 'black';
        titleText.textContent = title;
        this.svg.appendChild(titleText);
        this.currentY -= 35;
      }
      
      return;
    }
    
    if (command === 'move') {
      const element = this.svg.querySelector(`#${cmd.id}`);
      if (element) {
        const x = parseFloat(cmd.x || 0);
        const y = this.cartesianToSvgY(parseFloat(cmd.y || 0));
        await this.animateMove(element, x, y, duration, easing);
      }
      return;
    }
    
    if (command === 'set_attribute') {
      const element = this.svg.querySelector(`#${cmd.id}`);
      if (element && cmd.attr && cmd.value !== undefined) {
        element.setAttribute(cmd.attr, cmd.value);
      }
      return;
    }
    
    if (command === 'zoom') {
      await this.handleZoom(cmd);
      return;
    }
    
    if (command === 'markdown') {
      await this.handleMarkdown(cmd);
      return;
    }
    
    if (command === 'math') {
      await this.handleMath(cmd);
      return;
    }
    
    if (command === 'pointer') {
      await this.handlePointer(cmd);
      return;
    }
    
    if (command === 'highlight') {
      await this.handleHighlight(cmd);
      return;
    }
    
    // Regular SVG element creation
    const element = document.createElementNS('http://www.w3.org/2000/svg', command || 'g');
    
    // Auto-generate ID if not provided
    if (!cmd.id) {
      element.id = `auto_${++this.autoIdCounter}`;
    } else {
      element.id = cmd.id;
    }
    
    // Set default styles
    element.style.fontFamily = cmd['font-family'] || 'Patrick Hand, cursive';
    element.style.fontSize = cmd['font-size'] || '14px';
    element.style.fill = cmd.fill || 'black';
    element.setAttribute('xml:space', 'preserve');
    
    // Set attributes
    for (const [key, value] of Object.entries(cmd)) {
      if (['action', 'command', 'duration', 'easing', 'group', 'font-family', 'font-size', 'fill', 'scroll_up', 'title'].includes(key)) {
        continue;
      }
      
      if (key.toLowerCase().startsWith('y') && ['y', 'y1', 'y2'].includes(key)) {
        // Only transform coordinates if not using SVG coordinate system
        const yValue = this.svgCoordinates ? value : this.cartesianToSvgY(value);
        element.setAttribute(key, yValue);
      } else {
        element.setAttribute(key, value);
      }
    }
    
      // Handle text content
      if (command === 'text' && cmd.text) {
        let x = parseFloat(cmd.x || this.xMargin);
        let y;
        
        if (cmd.y !== undefined) {
          // Explicit Y coordinate provided
          y = this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y));
        } else {
          // Auto-positioning: currentY is in mathematical coordinates
          y = this.svgCoordinates ? this.currentY : this.cartesianToSvgY(this.currentY);
          
          // Check if text would go off the bottom of the container
          if (y > parseFloat(this.height) - 30) {
            await this.scrollArea();
            y = this.svgCoordinates ? this.currentY : this.cartesianToSvgY(this.currentY);
          }
          
          // Increment currentY AFTER calculating Y coordinate
          this.currentY += this.lineSize;
        }
      
      element.setAttribute('x', x);
      element.setAttribute('y', y);
      
      // Handle line breaks
      const text = cmd.text;
      if (text.includes('\n')) {
        const lines = text.split('\n');
        element.textContent = '';
        
        for (let i = 0; i < lines.length; i++) {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', x);
          if (i > 0) {
            tspan.setAttribute('dy', '1.2em');
          }
          element.appendChild(tspan);
          
          // Animate character by character
          if (duration > 0) {
            const charDelay = duration / text.length;
            for (const char of lines[i]) {
              tspan.textContent += char;
              await this.sleep(charDelay * 1000);
            }
          } else {
            tspan.textContent = lines[i];
          }
        }
      } else {
        // Animate character by character
        if (duration > 0) {
          const charDelay = duration / text.length;
          for (const char of text) {
            element.textContent += char;
            await this.sleep(charDelay * 1000);
          }
        } else {
          element.textContent = text;
        }
      }
    }
    
    // Add to SVG
    this.svg.appendChild(element);
    
    // Animate if duration > 0
    if (duration > 0) {
      await this.animateDraw(element, duration, easing);
    }
  }

  // Special command handlers
  async handleMarkdown(cmd) {
    const x = parseFloat(cmd.x || this.xMargin);
    let y = cmd.y !== undefined ? 
      (this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y))) : 
      (this.svgCoordinates ? this.currentY - this.lineSize : this.cartesianToSvgY(this.currentY - this.lineSize));
    
    if (cmd.y === undefined) {
      if (y < 10) {
        await this.scrollArea();
        y = this.cartesianToSvgY(parseFloat(this.height) / 2 - this.lineSize);
        this.currentY = parseFloat(this.height) / 2;
      }
      this.currentY -= this.lineSize;
    }
    
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', x);
    foreignObject.setAttribute('y', y);
    foreignObject.setAttribute('width', '300');
    foreignObject.setAttribute('height', '10');
    
    const div = document.createElement('div');
    div.style.fontSize = cmd['font-size'] || '14px';
    div.style.color = cmd.fill || 'black';
    div.style.display = 'inline-block';
    div.style.visibility = 'hidden';
    
    // Simple markdown rendering (you can enhance this)
    const text = cmd.text || '';
    div.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    
    foreignObject.appendChild(div);
    this.svg.appendChild(foreignObject);
    
    // Wait for rendering and measure
    await this.sleep(50);
    const width = div.scrollWidth;
    const height = div.scrollHeight;
    foreignObject.setAttribute('width', width);
    foreignObject.setAttribute('height', height);
    div.style.visibility = 'visible';
    
    if (cmd.y === undefined) {
      this.currentY -= height;
    }
  }

  async handleMath(cmd) {
    const x = parseFloat(cmd.x || this.xMargin);
    let y = cmd.y !== undefined ? 
      (this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y))) : 
      (this.svgCoordinates ? this.currentY - this.lineSize : this.cartesianToSvgY(this.currentY - this.lineSize));
    
    if (cmd.y === undefined) {
      if (y < 10) {
        await this.scrollArea();
        y = this.cartesianToSvgY(parseFloat(this.height) / 2 - this.lineSize);
        this.currentY = parseFloat(this.height) / 2;
      }
      this.currentY -= this.lineSize;
    }
    
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', x);
    foreignObject.setAttribute('y', y);
    foreignObject.setAttribute('width', '300');
    foreignObject.setAttribute('height', '50');
    foreignObject.style.opacity = '0';
    
    const div = document.createElement('div');
    div.style.fontSize = cmd['font-size'] || '16px';
    div.style.color = cmd.fill || 'darkred';
    div.style.display = 'inline-block';
    
    let mathText = (cmd.text || '').trim();
    const ascii = cmd.ascii !== false;
    const isAscii = ascii || (mathText.startsWith('@') && mathText.endsWith('@'));
    
    if (isAscii) {
      if (!mathText.startsWith('@')) {
        mathText = '@' + mathText + '@';
      }
      div.innerHTML = mathText;
    } else {
      if (!mathText.startsWith('$$')) {
        mathText = '$$' + mathText + '$$';
      }
      div.innerHTML = mathText;
    }
    
    foreignObject.appendChild(div);
    this.svg.appendChild(foreignObject);
    
    // Typeset with MathJax if available
    if (window.MathJax && window.MathJax.typeset) {
      window.MathJax.typeset([div]);
    }
    
    await this.sleep(100);
    
    const width = div.scrollWidth;
    const height = div.scrollHeight;
    foreignObject.setAttribute('width', width);
    foreignObject.setAttribute('height', height);
    
    if (cmd.y === undefined) {
      this.currentY -= height;
    }
    
    foreignObject.style.transition = 'opacity 0.2s ease-in-out';
    foreignObject.style.opacity = '1';
  }

  async handlePointer(cmd) {
    const x = parseFloat(cmd.x || 0);
    const y = this.svgCoordinates ? parseFloat(cmd.y || 0) : this.cartesianToSvgY(parseFloat(cmd.y || 0));
    const r = parseFloat(cmd.r || 5);
    const duration = parseFloat(cmd.duration || 1);
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.className = 'pointer-circle';
    
    this.svg.appendChild(circle);
    
    await this.sleep(duration * 1000);
    circle.remove();
  }

  async handleHighlight(cmd) {
    const element = this.svg.querySelector(`#${cmd.id}`);
    if (!element) return;
    
    const color = cmd.color || '#ff0';
    const duration = parseFloat(cmd.duration || 1);
    
    const oldStroke = element.getAttribute('stroke');
    const oldStrokeWidth = element.getAttribute('stroke-width');
    
    element.setAttribute('stroke', color);
    element.setAttribute('stroke-width', '4');
    element.classList.add('highlighted');
    
    await this.sleep(duration * 1000);
    
    if (oldStroke) {
      element.setAttribute('stroke', oldStroke);
    } else {
      element.removeAttribute('stroke');
    }
    
    if (oldStrokeWidth) {
      element.setAttribute('stroke-width', oldStrokeWidth);
    } else {
      element.removeAttribute('stroke-width');
    }
    
    element.classList.remove('highlighted');
  }

  async handleZoom(cmd) {
    const reset = cmd.reset || false;
    const level = parseFloat(cmd.level || 1.0);
    
    if (!this.zoomGroup) {
      this.zoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.zoomGroup.id = 'zoom-container';
      
      const children = Array.from(this.svg.children);
      children.forEach(child => this.zoomGroup.appendChild(child));
      this.svg.appendChild(this.zoomGroup);
    }
    
    if (reset || Math.abs(level - 1.0) < 1e-9) {
      this.currentZoomFactor = 1.0;
      this.zoomGroup.setAttribute('transform', '');
      return;
    }
    
    this.currentZoomFactor = level;
    
    const elementId = cmd.id;
    if (elementId) {
      const target = this.svg.querySelector(`#${elementId}`);
      if (target) {
        const tx = parseFloat(target.getAttribute('x') || 0);
        const ty = this.cartesianToSvgY(parseFloat(target.getAttribute('y') || 0));
        const transform = `translate(${tx},${ty}) scale(${level}) translate(${-tx},${-ty})`;
        this.zoomGroup.setAttribute('transform', transform);
        return;
      }
    }
    
    const zx = parseFloat(cmd.x || 0);
    const zy = this.cartesianToSvgY(parseFloat(cmd.y || 0));
    const transform = `translate(${zx},${zy}) scale(${level}) translate(${-zx},${-zy})`;
    this.zoomGroup.setAttribute('transform', transform);
  }

  async handleQuestion(cmd) {
    const question = cmd.question || '(No question)';
    const alternatives = cmd.alternatives || [];
    const correctIdx = cmd.answer || 0;
    
    const overlay = document.createElement('div');
    overlay.className = 'question-overlay';
    overlay.id = `question_${Date.now()}`;
    
    const box = document.createElement('div');
    box.className = 'question-box';
    
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-text';
    questionDiv.textContent = question;
    box.appendChild(questionDiv);
    
    const answersDiv = document.createElement('div');
    
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'question-feedback';
    feedbackDiv.style.color = 'blue';
    feedbackDiv.style.fontWeight = 'bold';
    
    const startTime = performance.now();
    let tries = 0;
    let correct = false;
    let correctOnFirstTry = false;
    
    alternatives.forEach((alt, idx) => {
      const option = document.createElement('div');
      option.className = 'question-option';
      option.textContent = alt;
      option.addEventListener('click', () => {
        tries++;
        this.questionStats.total_tries++;
        
        if (idx === correctIdx) {
          correct = true;
          this.questionStats.total_corrects++;
          if (tries === 1) {
            correctOnFirstTry = true;
            this.questionStats.total_correct_on_first_try++;
          }
          
          feedbackDiv.textContent = 'Correct!';
          feedbackDiv.style.color = 'green';
          
          const endTime = performance.now();
          const timeSpent = (endTime - startTime) / 1000;
          this.questionStats.total_time_on_questions += timeSpent;
          
          setTimeout(() => {
            overlay.remove();
          }, 800);
        } else {
          feedbackDiv.textContent = 'Try again!';
          feedbackDiv.style.color = 'red';
        }
      });
      answersDiv.appendChild(option);
    });
    
    box.appendChild(answersDiv);
    box.appendChild(feedbackDiv);
    overlay.appendChild(box);
    
    this.shadowRoot.appendChild(overlay);
    
    // Wait for question to be answered
    return new Promise((resolve) => {
      const checkRemoved = () => {
        if (!document.contains(overlay)) {
          resolve();
        } else {
          setTimeout(checkRemoved, 100);
        }
      };
      checkRemoved();
    });
  }

  async scrollArea() {
    // Simple scroll implementation - move all content up to make room for new text
    const children = Array.from(this.svg.children);
    const tempGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    children.forEach(child => tempGroup.appendChild(child));
    this.svg.appendChild(tempGroup);
    
    const offset = parseFloat(this.height) * 0.6; // Scroll up by 60% of height
    await this.animateMove(tempGroup, 0, -offset, 0.5);
    
    // Clear and reset
    this.svg.innerHTML = '';
    // Reset currentY to a position that will be near the top after conversion
    this.currentY = parseFloat(this.height) - 30; // Near top in mathematical coordinates
  }

  // Utility functions

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Control methods
  async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  onSliderInput(e) {
    if (this.isPlaying) {
      this.pause();
    }
    const value = parseInt(e.target.value);
    this.currentIndex = value;
    this.fastRedraw(value);
  }

  onSliderChange(e) {
    const value = parseInt(e.target.value);
    this.currentIndex = value;
    this.fastRedraw(value);
  }

  fastRedraw(index) {
    // Clear screen
    this.svg.innerHTML = '';
    if (this.subtitles) {
      this.subtitles.style.display = 'none';
    }
    this.groups = {};
    this.zoomGroup = null;
    this.currentZoomFactor = 1.0;
    this.currentY = parseFloat(this.height) - this.yMargin;
    
    // Re-apply commands up to index (without duration)
    for (let i = 0; i < index; i++) {
      const cmd = this.processedCommands[i];
      const action = cmd.action?.toLowerCase();
      
      if (action === 'svg') {
        const localCmd = { ...cmd, duration: 0 };
        this.executeSvgCommand(localCmd);
      } else if (action?.startsWith('speak_and_')) {
        if (cmd.draw) {
          const localCmd = { ...cmd.draw, duration: 0 };
          this.executeSvgCommand(localCmd);
        } else if (cmd.move) {
          const moveCmd = { ...cmd.move, command: 'move', duration: 0 };
          this.executeSvgCommand(moveCmd);
        }
      } else if (action === 'math') {
        this.handleMath(cmd);
      } else if (action === 'markdown') {
        this.handleMarkdown(cmd);
      } else if (action === 'zoom') {
        this.handleZoom(cmd);
      }
    }
  }

  async playFromCurrent() {
    console.log('Starting playFromCurrent, commands:', this.processedCommands.length, 'currentIndex:', this.currentIndex);
    while (this.currentIndex < this.processedCommands.length && this.isPlaying) {
      const cmd = this.processedCommands[this.currentIndex];
      const action = cmd.action?.toLowerCase();
      console.log('Executing command:', cmd, 'action:', action);
      
      try {
        if (action === 'svg') {
          await this.executeSvgCommand(cmd);
        } else if (action === 'speak') {
          await this.speakText(cmd);
        } else if (action === 'pause') {
          await this.sleep((cmd.seconds || 1) * 1000);
        } else if (action === 'delete') {
          const element = this.svg.querySelector(`#${cmd.id}`);
          if (element) element.remove();
        } else if (action === 'question') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
          await this.handleQuestion(cmd);
        } else if (action === 'audio') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
          // Audio playback implementation
          if (cmd.src) {
            const audio = new Audio(cmd.src);
            audio.play();
            await new Promise(resolve => {
              audio.onended = resolve;
              audio.onerror = resolve;
            });
          }
        } else if (action === 'math') {
          await this.handleMath(cmd);
        } else if (action === 'markdown') {
          await this.handleMarkdown(cmd);
        } else if (action === 'pointer') {
          await this.handlePointer(cmd);
        } else if (action === 'highlight') {
          await this.handleHighlight(cmd);
        } else if (action === 'zoom') {
          await this.handleZoom(cmd);
        } else if (action === 'alert') {
          await this.executeAlertCommand(cmd);
        } else if (action === 'speak_and_draw') {
          this.speakText(cmd.speak || {});
          await this.executeSvgCommand(cmd.draw || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_move') {
          this.speakText(cmd.speak || {});
          const moveCmd = { ...cmd.move, command: 'move' };
          await this.executeSvgCommand(moveCmd);
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_highlight') {
          this.speakText(cmd.speak || {});
          await this.handleHighlight(cmd.highlight || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_point') {
          this.speakText(cmd.speak || {});
          await this.handlePointer(cmd.pointer || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'finish_speaking') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        }
      } catch (error) {
        console.error('Error executing command:', cmd, error);
      }
      
      this.currentIndex++;
      this.shadowRoot.getElementById('progress-slider').value = this.currentIndex;
      
      if (this.currentIndex >= this.commands.length) {
        break;
      }
      
      await this.sleep(40);
    }
    
    this.isPlaying = false;
    console.log('Done playing!');
    console.log('Question Stats:', this.questionStats);
  }

  // Public API methods
  setCommands(commands) {
    this.commands = commands;
    this.processedCommands = this.translateToComplete(commands);
    const slider = this.shadowRoot?.getElementById('progress-slider');
    if (slider) {
      slider.max = this.processedCommands.length;
    }
    this.currentIndex = 0;
    this.fastRedraw(0);
  }

  getCommands() {
    return this.commands;
  }

  getQuestionStats() {
    return this.questionStats;
  }

  // Expose control methods as public API
  play() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.isPlaying = true;
    this.isPaused = false;
    if (this.controls) {
      this.controls.classList.add('visible');
    }
    this.playFromCurrent();
  }

  pause() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.isPlaying = false;
    this.isPaused = true;
    if (this.currentUtterance) {
      window.speechSynthesis.cancel();
    }
  }

  rewind() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.pause();
    this.currentIndex = 0;
    const slider = this.shadowRoot?.getElementById('progress-slider');
    if (slider) {
      slider.value = '0';
    }
    this.fastRedraw(0);
  }

  toggleSubtitles() {
    this.showSubtitles = !this.showSubtitles;
  }
}

// Register the web component
customElements.define('explainer-player', ExplainerPlayer);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExplainerPlayer;
}
