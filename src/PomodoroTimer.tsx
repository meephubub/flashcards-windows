import { useState, useEffect, useRef, useCallback } from 'react';
import './pomodoro-timer.css';

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
}

interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
}

interface AudioContextState {
  context: AudioContext | null;
  source: MediaElementAudioSourceNode | null;
  pinkNoiseNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  pinkNoiseGain: GainNode | null;
  compressor: DynamicsCompressorNode | null;
}

export default function PomodoroTimer() {
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isWorkSession, setIsWorkSession] = useState(true);
  const [sessionCount, setSessionCount] = useState(0);
  const [spotifyToken, setSpotifyToken] = useState<string>('');
  const [isSpotifyReady, setIsSpotifyReady] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [pinkNoiseVolume, setPinkNoiseVolume] = useState(0.1);
  const [showSettings, setShowSettings] = useState(false);
  const [gainReduction, setGainReduction] = useState(0.3);
  
  const audioStateRef = useRef<AudioContextState>({
    context: null,
    source: null,
    pinkNoiseNode: null,
    gainNode: null,
    pinkNoiseGain: null,
    compressor: null,
  });
  
  const audioElementRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize audio context for pink noise and gain control
  const initAudioContext = useCallback(async () => {
    if (audioStateRef.current.context) return;
    
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContext();
    
    // Create pink noise buffer
    const bufferSize = 2 * context.sampleRate;
    const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }
    
    let lastOut = 0;
    
    const pinkNoiseNode = context.createBufferSource();
    pinkNoiseNode.buffer = noiseBuffer;
    pinkNoiseNode.loop = true;
    
    const pinkNoiseGain = context.createGain();
    pinkNoiseGain.gain.value = pinkNoiseVolume;
    
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    const gainNode = context.createGain();
    gainNode.gain.value = volume;
    
    pinkNoiseNode.connect(pinkNoiseGain);
    pinkNoiseGain.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(context.destination);
    
    audioStateRef.current = {
      context,
      source: null,
      pinkNoiseNode,
      gainNode,
      pinkNoiseGain,
      compressor,
    };
    
    pinkNoiseNode.start();
  }, [pinkNoiseVolume, volume]);

  // Spotify SDK initialization
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
    
    window.onSpotifyWebPlaybackSDKReady = () => {
      const token = localStorage.getItem('spotify_token');
      if (token) {
        setSpotifyToken(token);
        initializePlayer(token);
      }
    };
    
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const initializePlayer = (token: string) => {
    const player = new (window as any).Spotify.Player({
      name: 'Pomodoro Timer',
      getOAuthToken: (cb: (token: string) => void) => { cb(token); },
      volume: volume * 100,
    });
    
    playerRef.current = player;
    
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      console.log('Ready with Device ID', device_id);
      setIsSpotifyReady(true);
      transferPlayback(device_id);
    });
    
    player.addListener('player_state_changed', (state: any) => {
      if (!state) return;
      setCurrentTrack(state.track_window.current_track);
      setIsPlaying(!state.paused);
    });
    
    player.connect();
  };

  const transferPlayback = async (deviceId: string) => {
    try {
      await fetch(`https://api.spotify.com/v1/me/player`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });
    } catch (error) {
      console.error('Error transferring playback:', error);
    }
  };

  const handleSpotifyLogin = () => {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
    const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
    const scopes = [
      'streaming',
      'user-read-email',
      'user-read-private',
      'user-library-read',
      'user-library-modify',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'app-remote-control',
    ].join(' ');
    
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    window.location.href = authUrl;
  };

  const searchTracks = async (query: string, minBpm?: number, maxBpm?: number) => {
    try {
      let searchQuery = query;
      if (minBpm && maxBpm) {
        searchQuery += ` bpm:${minBpm}-${maxBpm}`;
      }
      
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${spotifyToken}`,
          },
        }
      );
      
      const data = await response.json();
      return data.tracks.items;
    } catch (error) {
      console.error('Error searching tracks:', error);
      return [];
    }
  };

  const playWorkMusic = async () => {
    const tracks = await searchTracks('classical instrumental piano violin cello', 60, 80);
    if (tracks.length > 0) {
      const foreignTracks = tracks.filter((track: SpotifyTrack) => {
        const name = track.name.toLowerCase();
        const artist = track.artists[0]?.name.toLowerCase();
        return !/english|lyrics|vocals|singing/i.test(name + artist);
      });
      
      const trackToPlay = foreignTracks.length > 0 ? foreignTracks[0] : tracks[0];
      playTrack(trackToPlay.uri);
    }
  };

  const playBreakMusic = async () => {
    const tracks = await searchTracks('pop rock upbeat energetic', 100, 140);
    if (tracks.length > 0) {
      playTrack(tracks[0].uri);
    }
  };

  const playTrack = async (uri: string) => {
    try {
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${playerRef.current?._options.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [uri] }),
      });
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing track:', error);
    }
  };

  const togglePlayback = async () => {
    try {
      if (isPlaying) {
        await fetch(`https://api.spotify.com/v1/me/player/pause`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyToken}` },
        });
      } else {
        await fetch(`https://api.spotify.com/v1/me/player/play`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyToken}` },
        });
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Error toggling playback:', error);
    }
  };

  // Timer logic
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handleSessionComplete();
            return isWorkSession ? 5 * 60 : 25 * 60;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, isWorkSession]);

  const handleSessionComplete = () => {
    setIsWorkSession(!isWorkSession);
    setSessionCount((prev) => prev + 1);
    
    if (!isWorkSession) {
      // Starting work session
      playWorkMusic();
    } else {
      // Starting break
      playBreakMusic();
    }
  };

  const toggleTimer = () => {
    if (!isRunning && isSpotifyReady) {
      initAudioContext();
      if (isWorkSession && !isPlaying) {
        playWorkMusic();
      }
    }
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(isWorkSession ? 25 * 60 : 5 * 60);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const updateVolume = (newVolume: number) => {
    setVolume(newVolume);
    if (audioStateRef.current.gainNode) {
      audioStateRef.current.gainNode.gain.value = newVolume;
    }
    if (playerRef.current) {
      playerRef.current.setVolume(newVolume * 100);
    }
  };

  const updatePinkNoiseVolume = (newVolume: number) => {
    setPinkNoiseVolume(newVolume);
    if (audioStateRef.current.pinkNoiseGain) {
      audioStateRef.current.pinkNoiseGain.gain.value = newVolume;
    }
  };

  const updateGainReduction = (newGain: number) => {
    setGainReduction(newGain);
    if (audioStateRef.current.compressor) {
      audioStateRef.current.compressor.ratio.value = 12 + (newGain * 10);
    }
  };

  return (
    <div className="pomodoro-container">
      <div className="pomodoro-card">
        <div className="pomodoro-header">
          <h2 className="pomodoro-title">
            {isWorkSession ? 'Focus Time' : 'Break Time'}
          </h2>
          <span className="session-counter">Session {sessionCount + 1}</span>
        </div>
        
        <div className="timer-display">
          <span className="timer-time">{formatTime(timeLeft)}</span>
        </div>
        
        <div className="timer-controls">
          <button 
            className="timer-btn primary"
            onClick={toggleTimer}
            disabled={!isSpotifyReady && !spotifyToken}
          >
            {isRunning ? 'Pause' : 'Start'}
          </button>
          <button className="timer-btn secondary" onClick={resetTimer}>
            Reset
          </button>
        </div>
        
        {spotifyToken ? (
          <div className="spotify-section">
            {currentTrack && (
              <div className="current-track">
                <div className="track-info">
                  <span className="track-name">{currentTrack.name}</span>
                  <span className="track-artist">{currentTrack.artists[0]?.name}</span>
                </div>
                <button className="playback-btn" onClick={togglePlayback}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
              </div>
            )}
            
            <div className="volume-controls">
              <div className="volume-slider">
                <label>Music</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => updateVolume(parseFloat(e.target.value))}
                />
              </div>
              <div className="volume-slider">
                <label>Pink Noise</label>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={pinkNoiseVolume}
                  onChange={(e) => updatePinkNoiseVolume(parseFloat(e.target.value))}
                />
              </div>
            </div>
          </div>
        ) : (
          <button className="spotify-login-btn" onClick={handleSpotifyLogin}>
            Connect Spotify
          </button>
        )}
        
        <button 
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙
        </button>
        
        {showSettings && (
          <div className="settings-panel">
            <div className="setting-item">
              <label>Gain Reduction</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={gainReduction}
                onChange={(e) => updateGainReduction(parseFloat(e.target.value))}
              />
            </div>
            <div className="setting-info">
              <p>• Work: Classical/Instrumental (60-80 BPM)</p>
              <p>• Break: Normal music</p>
              <p>• Pink noise overlay for focus</p>
              <p>• Gain control for flat audio</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
