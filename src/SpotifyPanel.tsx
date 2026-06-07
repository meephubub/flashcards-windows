import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  Music,
  ExternalLink,
  Search,
  Laptop,
  Check,
  ChevronDown,
  X,
  RefreshCw,
  LogOut,
  HelpCircle,
  ArrowLeft,
} from "lucide-react";

interface SpotifyPanelProps {
  onClose: () => void;
}

interface Track {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  duration_ms: number;
  uri: string;
}

interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

interface PlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: Track | null;
  device: Device;
  shuffle_state: boolean;
  repeat_state: "off" | "track" | "context";
}

const AI_SIDECAR_URL = import.meta.env.VITE_AI_SIDECAR_URL || "http://127.0.0.1:8787";

export function SpotifyPanel({ onClose }: SpotifyPanelProps) {
  const [token, setToken] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Playback state
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [volume, setVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(50);

  // Local progress tracker for smooth real-time scrubbing
  const [localProgress, setLocalProgress] = useState(0);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    tracks: Track[];
    playlists: { id: string; name: string; images: { url: string }[]; uri: string }[];
  }>({ tracks: [], playlists: [] });
  const [isSearching, setIsSearching] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Check sidecar for Spotify connection token
  const checkAuth = async () => {
    try {
      const res = await fetch(`${AI_SIDECAR_URL}/spotify/token`);
      if (res.status === 200) {
        const data = await res.json();
        setToken(data.access_token);
        setIsConfigured(true);
        setAuthError(null);
      } else if (res.status === 401) {
        const data = await res.json();
        setIsConfigured(data.error !== "unconfigured");
        setToken(null);
      }
    } catch (err) {
      console.error("[spotify] Auth check failed:", err);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Poll for token connection when unauthenticated but configured
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (!token && isConfigured) {
      interval = setInterval(() => {
        checkAuth();
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [token, isConfigured]);

  // 2. Load playback state and devices once authenticated
  const fetchPlayback = async () => {
    if (!token) return;
    try {
      const res = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 200) {
        const data = await res.json();
        setPlayback(data);
        setVolume(data.device?.volume_percent ?? 50);
        if (!isDraggingProgress) {
          setLocalProgress(data.progress_ms || 0);
        }
      } else if (res.status === 204) {
        // Active playback not found
        setPlayback(null);
      } else if (res.status === 401) {
        // Token might have expired, checkAuth will trigger refresh via sidecar
        await checkAuth();
      }
    } catch (err) {
      console.error("[spotify] Failed to fetch playback:", err);
    }
  };

  const fetchDevices = async () => {
    if (!token) return;
    try {
      const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      console.error("[spotify] Failed to fetch devices:", err);
    }
  };

  // Setup timers for playback polling and local progress ticking
  useEffect(() => {
    if (token) {
      fetchPlayback();
      fetchDevices();
      pollIntervalRef.current = setInterval(() => {
        fetchPlayback();
        fetchDevices();
      }, 3000);

      progressIntervalRef.current = setInterval(() => {
        setPlayback((prev) => {
          if (prev && prev.is_playing && !isDraggingProgress) {
            setLocalProgress((p) => {
              const duration = prev.item?.duration_ms || 0;
              if (p + 1000 >= duration) {
                // Fetch next state when track ends
                setTimeout(fetchPlayback, 500);
                return duration;
              }
              return p + 1000;
            });
          }
          return prev;
        });
      }, 1000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [token, isDraggingProgress]);

  // Handle Spotify setup configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;

    setIsSavingConfig(true);
    setAuthError(null);
    try {
      const res = await fetch(`${AI_SIDECAR_URL}/spotify/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      });
      if (res.ok) {
        setIsConfigured(true);
        // Request authorization URL
        handleConnect();
      } else {
        const data = await res.json();
        setAuthError(data.error || "Failed to save configuration.");
      }
    } catch (err) {
      setAuthError("Failed to communicate with sidecar server.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch(`${AI_SIDECAR_URL}/spotify/auth-url`);
      if (res.ok) {
        const data = await res.json();
        // Open URL in system browser
        window.open(data.url, "_blank");
      } else {
        const data = await res.json();
        setAuthError(data.error || "Failed to retrieve connection URL.");
      }
    } catch (err) {
      setAuthError("Could not retrieve connection URL.");
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect Spotify?")) return;
    try {
      await fetch(`${AI_SIDECAR_URL}/spotify/disconnect`, { method: "POST" });
      setToken(null);
      setIsConfigured(false);
      setPlayback(null);
      setClientId("");
      setClientSecret("");
    } catch (err) {
      console.error("[spotify] Failed to disconnect:", err);
    }
  };

  // Player Actions (Spotify API wrapper calls)
  const spotifyCall = async (endpoint: string, method: string = "GET", body?: any) => {
    if (!token) return;
    try {
      const res = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) {
        await checkAuth();
      }
      return res;
    } catch (err) {
      console.error(`[spotify] API call ${endpoint} failed:`, err);
    }
  };

  const togglePlay = async () => {
    if (!playback) return;
    const isPlaying = playback.is_playing;
    // Optimistic state updates
    setPlayback((prev) => prev ? { ...prev, is_playing: !isPlaying } : null);

    if (isPlaying) {
      await spotifyCall("me/player/pause", "PUT");
    } else {
      await spotifyCall("me/player/play", "PUT");
    }
    setTimeout(fetchPlayback, 300);
  };

  const skipNext = async () => {
    await spotifyCall("me/player/next", "POST");
    setTimeout(fetchPlayback, 500);
  };

  const skipPrev = async () => {
    await spotifyCall("me/player/previous", "POST");
    setTimeout(fetchPlayback, 500);
  };

  const toggleShuffle = async () => {
    if (!playback) return;
    const nextShuffle = !playback.shuffle_state;
    setPlayback((prev) => prev ? { ...prev, shuffle_state: nextShuffle } : null);
    await spotifyCall(`me/player/shuffle?state=${nextShuffle}`, "PUT");
  };

  const toggleRepeat = async () => {
    if (!playback) return;
    const cycleMap: Record<PlaybackState["repeat_state"], PlaybackState["repeat_state"]> = {
      off: "context",
      context: "track",
      track: "off",
    };
    const nextRepeat = cycleMap[playback.repeat_state];
    setPlayback((prev) => prev ? { ...prev, repeat_state: nextRepeat } : null);
    await spotifyCall(`me/player/repeat?state=${nextRepeat}`, "PUT");
  };

  const handleSeek = async (value: number) => {
    setLocalProgress(value);
    await spotifyCall(`me/player/seek?position_ms=${value}`, "PUT");
    setIsDraggingProgress(false);
    setTimeout(fetchPlayback, 300);
  };

  const handleVolumeChange = async (value: number) => {
    setVolume(value);
    setIsMuted(value === 0);
    await spotifyCall(`me/player/volume?volume_percent=${value}`, "PUT");
  };

  const toggleMute = async () => {
    if (isMuted) {
      setVolume(prevVolume);
      setIsMuted(false);
      await spotifyCall(`me/player/volume?volume_percent=${prevVolume}`, "PUT");
    } else {
      setPrevVolume(volume);
      setVolume(0);
      setIsMuted(true);
      await spotifyCall("me/player/volume?volume_percent=0", "PUT");
    }
  };

  const switchDevice = async (deviceId: string) => {
    setShowDeviceSelector(false);
    await spotifyCall("me/player", "PUT", { device_ids: [deviceId] });
    setTimeout(fetchPlayback, 500);
  };

  // Search tracks & playlists
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const res = await spotifyCall(
        `search?q=${encodeURIComponent(searchQuery)}&type=track,playlist&limit=6`
      );
      if (res && res.ok) {
        const data = await res.json();
        setSearchResults({
          tracks: data.tracks?.items || [],
          playlists: data.playlists?.items || [],
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const playItem = async (uri: string) => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults({ tracks: [], playlists: [] });
    
    const body = uri.includes("track") ? { uris: [uri] } : { context_uri: uri };
    await spotifyCall("me/player/play", "PUT", body);
    setTimeout(fetchPlayback, 500);
  };

  // Format Helper
  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  if (isCheckingAuth) {
    return (
      <div className="spotify-loading-container">
        <RefreshCw size={24} className="spin text-spotify" />
        <span>Syncing with Spotify...</span>
      </div>
    );
  }

  // --- CONNECT / SETUP SCREEN ---
  if (!token) {
    return (
      <div className="spotify-setup-panel">
        <header className="spotify-setup-header">
          <button className="spotify-back-btn" onClick={onClose}>
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <h2>Spotify Integration</h2>
        </header>

        <div className="spotify-setup-body">
          {!isConfigured ? (
            <form onSubmit={handleSaveConfig} className="spotify-setup-form">
              <div className="setup-intro">
                <Music size={32} className="text-spotify animate-pulse" />
                <p>Link your Spotify account to control playback directly from your dashboard.</p>
              </div>

              <div className="form-group">
                <label>Client ID</label>
                <input
                  type="text"
                  placeholder="Enter Spotify Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Client Secret</label>
                <input
                  type="password"
                  placeholder="Enter Spotify Client Secret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  required
                />
              </div>

              {authError && <p className="spotify-error-msg">{authError}</p>}

              <button
                type="submit"
                disabled={isSavingConfig}
                className="spotify-primary-btn"
              >
                {isSavingConfig ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save & Connect</span>
                )}
              </button>

              <button
                type="button"
                className="spotify-help-btn"
                onClick={() => setShowSetupGuide(!showSetupGuide)}
              >
                <HelpCircle size={14} />
                <span>{showSetupGuide ? "Hide Setup Guide" : "Show Setup Guide"}</span>
              </button>

              {showSetupGuide && (
                <div className="spotify-setup-guide">
                  <h4>How to get credentials:</h4>
                  <ol>
                    <li>Go to the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard <ExternalLink size={10} /></a> and log in.</li>
                    <li>Click <strong>Create App</strong>.</li>
                    <li>Enter any App name and description.</li>
                    <li>In the <strong>Redirect URIs</strong> field, add exactly: <code className="select-all">http://localhost:8787/spotify/callback</code></li>
                    <li>Select the Web API checkbox and save.</li>
                    <li>Go to your App settings, copy the <strong>Client ID</strong> and <strong>Client Secret</strong>, and paste them above.</li>
                  </ol>
                </div>
              )}
            </form>
          ) : (
            <div className="spotify-connect-step">
              <Music size={40} className="text-spotify mb-2" />
              <h3>Configuration Saved!</h3>
              <p>Click below to complete Spotify authorization in your browser.</p>

              {authError && <p className="spotify-error-msg">{authError}</p>}

              <div className="button-group-vertical">
                <button onClick={handleConnect} className="spotify-primary-btn">
                  Connect Spotify Account
                </button>
                <button
                  onClick={() => setIsConfigured(false)}
                  className="spotify-secondary-btn"
                >
                  Edit API Credentials
                </button>
              </div>

              <div className="waiting-indicator">
                <RefreshCw size={14} className="spin" />
                <span>Waiting for connection in browser...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- PLAYER PANEL ---
  const currentTrack = playback?.item;
  const isPlaying = playback?.is_playing || false;
  const duration = currentTrack?.duration_ms || 0;
  const progressPercent = duration > 0 ? (localProgress / duration) * 100 : 0;

  return (
    <div className="spotify-player-panel">
      {/* HEADER NAVBAR */}
      <header className="spotify-player-header">
        <div className="header-left">
          <Music size={16} className="text-spotify" />
          <span>Spotify</span>
        </div>

        <div className="header-actions">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`icon-btn ${showSearch ? "active" : ""}`}
            title="Search Music"
          >
            <Search size={15} />
          </button>
          <button
            onClick={() => setShowDeviceSelector(!showDeviceSelector)}
            className={`icon-btn ${showDeviceSelector ? "active" : ""} ${playback?.device?.is_active ? "text-spotify" : ""}`}
            title="Devices"
          >
            <Laptop size={15} />
          </button>
          <button
            onClick={handleDisconnect}
            className="icon-btn text-red"
            title="Disconnect Account"
          >
            <LogOut size={14} />
          </button>
          <button onClick={onClose} className="icon-btn close-btn" title="Back">
            <X size={15} />
          </button>
        </div>
      </header>

      {/* DEVICE SELECTOR OVERLAY */}
      {showDeviceSelector && (
        <div className="spotify-dropdown-overlay">
          <div className="dropdown-header">
            <span>Connect to a device</span>
            <button onClick={() => setShowDeviceSelector(false)}>
              <X size={12} />
            </button>
          </div>
          <div className="device-list">
            {devices.length === 0 ? (
              <div className="empty-devices">No active Spotify devices found. Open Spotify on your phone/computer.</div>
            ) : (
              devices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => switchDevice(device.id)}
                  className={`device-item ${device.is_active ? "active" : ""}`}
                >
                  <Laptop size={14} />
                  <div className="device-info">
                    <span className="device-name">{device.name}</span>
                    <span className="device-type">{device.type}</span>
                  </div>
                  {device.is_active && <Check size={14} className="text-spotify" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* SEARCH AND PLAYLISTS OVERLAY */}
      {showSearch && (
        <div className="spotify-search-overlay">
          <form onSubmit={handleSearch} className="spotify-search-form">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              placeholder="Search songs or playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults({ tracks: [], playlists: [] });
                }}
                className="clear-search"
              >
                <X size={14} />
              </button>
            )}
          </form>

          <div className="search-results-container">
            {isSearching ? (
              <div className="search-loading">
                <RefreshCw size={18} className="spin text-spotify" />
                <span>Searching Spotify...</span>
              </div>
            ) : searchResults.tracks.length === 0 && searchResults.playlists.length === 0 ? (
              <div className="search-empty-state">
                {searchQuery ? "No results found." : "Type above to search Spotify catalogs directly!"}
              </div>
            ) : (
              <div className="search-scroll-area">
                {searchResults.tracks.length > 0 && (
                  <div className="result-section">
                    <h5>Songs</h5>
                    {searchResults.tracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={() => playItem(track.uri)}
                        className="search-result-item"
                      >
                        <img
                          src={track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || ""}
                          alt=""
                        />
                        <div className="result-text">
                          <span className="result-title">{track.name}</span>
                          <span className="result-subtitle">
                            {track.artists.map((a) => a.name).join(", ")}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults.playlists.length > 0 && (
                  <div className="result-section mt-3">
                    <h5>Playlists</h5>
                    {searchResults.playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => playItem(pl.uri)}
                        className="search-result-item"
                      >
                        <img src={pl.images?.[0]?.url || ""} alt="" />
                        <div className="result-text">
                          <span className="result-title">{pl.name}</span>
                          <span className="result-subtitle">Playlist</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CORE PLAYER INTERFACE */}
      {playback && currentTrack ? (
        <div className="spotify-player-body">
          {/* Cover Art with subtle backglow */}
          <div className="cover-art-container">
            <div
              className="cover-art-glow"
              style={{
                backgroundImage: `url(${currentTrack.album?.images?.[0]?.url})`,
              }}
            />
            <img
              src={currentTrack.album?.images?.[0]?.url}
              alt={currentTrack.name}
              className={`cover-art ${isPlaying ? "playing" : ""}`}
            />
          </div>

          {/* Metadata */}
          <div className="track-details">
            <div className="track-marquee">
              <span className="track-name">{currentTrack.name}</span>
            </div>
            <span className="track-artists">
              {currentTrack.artists.map((artist) => artist.name).join(", ")}
            </span>
          </div>

          {/* Progress / Seek bar */}
          <div className="progress-section">
            <div className="progress-bar-wrap">
              <span className="time-label">{formatTime(localProgress)}</span>
              <div
                className="progress-bar-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                  handleSeek(Math.floor(ratio * duration));
                }}
              >
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={localProgress}
                  onChange={(e) => {
                    setIsDraggingProgress(true);
                    setLocalProgress(Number(e.target.value));
                  }}
                  onMouseUp={(e) => handleSeek(Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => handleSeek(Number((e.target as HTMLInputElement).value))}
                  className="progress-scrubber"
                />
              </div>
              <span className="time-label">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="playback-controls">
            <button
              onClick={toggleShuffle}
              className={`ctrl-btn shuffle-btn ${playback.shuffle_state ? "active text-spotify" : ""}`}
              title="Shuffle"
            >
              <Shuffle size={14} />
            </button>

            <button onClick={skipPrev} className="ctrl-btn prev-btn" title="Previous">
              <SkipBack size={18} />
            </button>

            <button onClick={togglePlay} className="ctrl-btn play-pause-btn" title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
            </button>

            <button onClick={skipNext} className="ctrl-btn next-btn" title="Next">
              <SkipForward size={18} />
            </button>

            <button
              onClick={toggleRepeat}
              className={`ctrl-btn repeat-btn ${playback.repeat_state !== "off" ? "active text-spotify" : ""}`}
              title={`Repeat: ${playback.repeat_state}`}
            >
              <Repeat size={14} />
              {playback.repeat_state === "track" && <span className="repeat-badge">1</span>}
            </button>
          </div>

          {/* Volume control */}
          <div className="volume-section">
            <button onClick={toggleMute} className="volume-icon-btn">
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <div className="volume-slider-wrap">
              <div
                className="volume-slider-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                  handleVolumeChange(Math.floor(ratio * 100));
                }}
              >
                <div
                  className="volume-slider-fill"
                  style={{ width: `${volume}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="volume-scrubber"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="spotify-empty-player">
          <Music size={36} className="text-muted mb-2 animate-bounce" />
          <h3>No Active Playback</h3>
          <p>Please open Spotify on your computer or phone and play a song, or use Search to pick a track.</p>
          <button onClick={fetchPlayback} className="spotify-refresh-btn">
            <RefreshCw size={13} />
            <span>Check Playback</span>
          </button>
        </div>
      )}

      {/* FOOTER WIDGET */}
      {playback?.device && (
        <footer className="spotify-footer">
          <Laptop size={12} className="text-spotify" />
          <span>Playing on <strong>{playback.device.name}</strong></span>
        </footer>
      )}
    </div>
  );
}
