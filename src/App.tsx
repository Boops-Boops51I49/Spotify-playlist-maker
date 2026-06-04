import React, { useState, useEffect, useRef } from 'react';
import { 
  Music, Search, Heart, Plus, LogOut, CheckSquare, 
  Square, AlertCircle, Loader2, Check, X 
} from 'lucide-react';

// --- Spotify API Configuration & Constants ---
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private'
].join(' ');

// For local Vite development, uncomment the next line and delete the string version:
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
// const CLIENT_ID = (import.meta as any)?.env?.VITE_SPOTIFY_CLIENT_ID || '';

// --- PKCE Auth Helpers ---
const generateRandomString = (length: number) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

const sha256 = async (plain: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input: ArrayBuffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

export default function App() {
  // App State
  const [token, setToken] = useState(localStorage.getItem('spotify_access_token') || '');
  const [user, setUser] = useState<any>(null);
  
  // UI State
  const [view, setView] = useState<'liked' | 'search'>('liked');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  
  // Data State
  const [songs, setSongs] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  // We now store a dictionary of the full track objects, keyed by their URI
  const [selectedTracks, setSelectedTracks] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [nextUrl, setNextUrl] = useState<string | null>(null);

  // Derived state for selected tracks
  const selectedCount = Object.keys(selectedTracks).length;
  const selectedArray = Object.values(selectedTracks);

  // Prevent double-fetching in React Strict Mode
  const hasFetchedToken = useRef(false);

  // --- Auth & Initialization (PKCE) ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code && !hasFetchedToken.current) {
      hasFetchedToken.current = true;
      exchangeToken(code);
    } else if (token) {
      fetchUserProfile();
      fetchPlaylists();
      if (view === 'liked') fetchLikedSongs();
    }
  }, [token, view]);

  // Clear notifications after 5 seconds
  useEffect(() => {
    if (error || successMsg) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccessMsg('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, successMsg]);

  // --- Authentication Methods ---
  const handleLogin = async () => {
    if (!CLIENT_ID) {
      setError("Missing Client ID: Please ensure VITE_SPOTIFY_CLIENT_ID is in your .env file and RESTART your terminal server (npm run dev).");
      return;
    }

    const codeVerifier = generateRandomString(64);
    window.localStorage.setItem('code_verifier', codeVerifier);
    
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    const redirectUri = window.location.origin;
    const authUrl = new URL("https://accounts.spotify.com/authorize");

    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
    }).toString();

    window.location.href = authUrl.toString();
  };

  const exchangeToken = async (code: string) => {
    const codeVerifier = localStorage.getItem('code_verifier');
    const redirectUri = window.location.origin;

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier || '',
        }),
      });

      if (!response.ok) throw new Error("Failed to exchange token. Please try logging in again.");

      const data = await response.json();
      localStorage.setItem('spotify_access_token', data.access_token);
      setToken(data.access_token);
      
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err: any) {
      setError(err.message);
      handleLogout();
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('code_verifier');
  };

  // --- Spotify API Calls ---
  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    try {
      const res = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      
      if (res.status === 401) {
        handleLogout();
        throw new Error('Session expired. Please log in again.');
      }
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || 'API request failed');
      }
      
      if (res.status === 204) return null;
      return await res.json();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const fetchUserProfile = async () => {
    try {
      const data = await apiCall('/me');
      setUser(data);
    } catch (e) { }
  };

  const fetchPlaylists = async () => {
    try {
      const data = await apiCall('/me/playlists?limit=50');
      setPlaylists(data.items);
    } catch (e) { }
  };

  const fetchLikedSongs = async () => {
    setIsLoading(true);
    setNextUrl(null);
    try {
      const data = await apiCall('/me/tracks?limit=50');
      setSongs(data.items.map((item: any) => item.track));
      setNextUrl(data.next);
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    setNextUrl(null);
    try {
      const data = await apiCall(`/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=50`);
      setSongs(data.tracks.items);
      setNextUrl(data.tracks.next);
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextUrl) return;
    setIsFetchingMore(true);
    try {
      const endpoint = nextUrl.replace(SPOTIFY_API_BASE, '');
      const data = await apiCall(endpoint);
      
      if (view === 'liked') {
        setSongs(prev => [...prev, ...data.items.map((item: any) => item.track)]);
        setNextUrl(data.next);
      } else {
        setSongs(prev => [...prev, ...data.tracks.items]);
        setNextUrl(data.tracks.next);
      }
    } catch (e) {
    } finally {
      setIsFetchingMore(false);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim() || selectedCount === 0 || !user) return;
    
    setIsLoading(true);
    try {
      const playlistData = await apiCall(`/users/${user.id}/playlists`, {
        method: 'POST',
        body: JSON.stringify({ name: newPlaylistName, description: 'Created via Spotify Playlist Builder', public: false })
      });

      await apiCall(`/playlists/${playlistData.id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ uris: Object.keys(selectedTracks) })
      });

      setSuccessMsg(`Created "${newPlaylistName}" and added ${selectedCount} songs!`);
      setNewPlaylistName('');
      setSelectedTracks({});
      fetchPlaylists(); 
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToExisting = async (playlistId: string, playlistName: string) => {
    if (selectedCount === 0) return;
    
    setIsLoading(true);
    try {
      await apiCall(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ uris: Object.keys(selectedTracks) })
      });
      
      setSuccessMsg(`Added ${selectedCount} songs to "${playlistName}"!`);
      setSelectedTracks({});
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  // --- Handlers ---
  const toggleSongSelection = (song: any) => {
    setSelectedTracks(prev => {
      const next = { ...prev };
      if (next[song.uri]) {
        delete next[song.uri];
      } else {
        next[song.uri] = song;
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    // Check if every song currently visible is already selected
    const currentUris = songs.filter(s => s).map(s => s.uri);
    const allSelected = currentUris.every(uri => selectedTracks[uri]);

    setSelectedTracks(prev => {
      const next = { ...prev };
      if (allSelected) {
        // Unselect all currently visible songs
        currentUris.forEach(uri => delete next[uri]);
      } else {
        // Select all currently visible songs
        songs.forEach(song => {
          if (song) next[song.uri] = song;
        });
      }
      return next;
    });
  };

  // --- Render Helpers ---
  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4">
        {/* Notifications */}
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-md px-4 pointer-events-none">
          {error && (
            <div className="bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}
        </div>

        <div className="max-w-md w-full text-center bg-neutral-800 p-8 rounded-2xl shadow-xl border border-neutral-700">
          <Music className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Playlist Builder</h1>
          <p className="text-neutral-400 mb-6">Select songs and curate your perfect playlists effortlessly.</p>
          
          <div className="bg-neutral-900 p-4 rounded-lg text-left mb-8 border border-neutral-700 text-sm">
             <p className="font-semibold text-yellow-500 mb-2 flex items-center gap-2">
               <AlertCircle className="w-4 h-4" /> Redirect URI Check
             </p>
             <p className="text-neutral-300 mb-2">To prevent login errors, ensure this exact URL is saved in your Spotify Developer Dashboard under <strong>Redirect URIs</strong>:</p>
             <code className="block bg-black p-3 rounded text-green-400 text-center select-all font-mono text-base border border-neutral-800">
               {window.location.origin}
             </code>
          </div>

          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-black font-bold py-4 px-6 rounded-full transition-transform hover:scale-105 active:scale-95"
          >
            Log in with Spotify
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans flex flex-col">
      {/* Notifications for Main Screen */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-md px-4 pointer-events-none">
        {error && (
          <div className="bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-500/90 text-black px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm">
            <Check className="w-5 h-5 shrink-0" />
            <span className="text-sm font-bold">{successMsg}</span>
          </div>
        )}
      </div>

      {/* Top Navbar */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <Music className="w-6 h-6 text-green-500" />
          <h1 className="text-xl font-bold text-white hidden sm:block">Playlist Builder</h1>
        </div>
        
        {user && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {user.images?.[0] ? (
                <img src={user.images[0].url} alt={user.display_name} className="w-8 h-8 rounded-full border border-neutral-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                  <span className="text-xs font-bold">{user.display_name?.[0]}</span>
                </div>
              )}
              <span className="text-sm font-medium hidden sm:block">{user.display_name}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="text-neutral-400 hover:text-white p-2 rounded-md hover:bg-neutral-800 transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </header>

      {/* Main Content Split */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Pane: Song Selection */}
        <div className="flex-1 flex flex-col bg-neutral-950 border-r border-neutral-800 overflow-hidden lg:max-w-3xl">
          
          {/* Tabs & Search */}
          <div className="p-6 border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-30">
            <div className="flex gap-4 mb-6">
              <button 
                onClick={() => setView('liked')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
                  view === 'liked' ? 'bg-green-500 text-black shadow-lg shadow-green-500/20' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white'
                }`}
              >
                <Heart className={`w-5 h-5 ${view === 'liked' ? 'fill-black' : ''}`} />
                Liked Songs
              </button>
              <button 
                onClick={() => setView('search')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
                  view === 'search' ? 'bg-green-500 text-black shadow-lg shadow-green-500/20' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white'
                }`}
              >
                <Search className="w-5 h-5" />
                Search
              </button>
            </div>

            {view === 'search' && (
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for tracks, artists..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-full pl-12 pr-4 py-3 text-white placeholder-neutral-500 focus:border-green-500 focus:outline-none transition-colors"
                />
                <button type="submit" className="hidden">Search</button>
              </form>
            )}
          </div>

          {/* List Header Actions */}
          <div className="px-6 py-4 flex justify-between items-center bg-neutral-900/50">
            <button 
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              {songs.length > 0 && songs.filter(s => s).every(s => selectedTracks[s.uri]) ? (
                <CheckSquare className="w-5 h-5 text-green-500" />
              ) : (
                <Square className="w-5 h-5 text-neutral-500" />
              )}
              Select All Current
            </button>
            <span className="text-sm text-neutral-500">{songs.length} tracks loaded</span>
          </div>

          {/* Songs List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1 pb-12">
            {isLoading && songs.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
              </div>
            ) : songs.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">
                {view === 'liked' ? "No liked songs found." : "Search for a song to get started."}
              </div>
            ) : (
              <>
                {songs.map((song, index) => {
                  if (!song) return null;
                  const isSelected = !!selectedTracks[song.uri];
                  return (
                    <div 
                      key={`${song.id}-${index}`} 
                      onClick={() => toggleSongSelection(song)}
                      className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors group ${
                        isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
                      }`}
                    >
                      <button className="shrink-0">
                        {isSelected ? (
                          <CheckSquare className="w-6 h-6 text-green-500" />
                        ) : (
                          <Square className="w-6 h-6 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
                        )}
                      </button>
                      
                      {song.album?.images?.[2] ? (
                        <img src={song.album.images[2].url} alt={song.album.name} className="w-12 h-12 rounded object-cover shadow" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-neutral-800 flex items-center justify-center">
                          <Music className="w-5 h-5 text-neutral-600" />
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${isSelected ? 'text-green-400' : 'text-white'}`}>
                          {song.name}
                        </p>
                        <p className="text-sm text-neutral-400 truncate">
                          {song.artists?.map((a: any) => a.name).join(', ')}
                        </p>
                      </div>
                    </div>
                  );
                })}
                
                {/* Pagination / Load More Button */}
                {nextUrl && (
                  <div className="py-8 flex justify-center">
                    <button 
                      onClick={loadMore}
                      disabled={isFetchingMore}
                      className="flex items-center gap-2 px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-full font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isFetchingMore ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Loading more...
                        </>
                      ) : (
                        'Load More Tracks'
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Pane: Playlist Actions */}
        <div className="w-full lg:w-96 bg-neutral-900 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)] z-20">
          
          <div className="p-6 bg-green-900/20 border-b border-green-900/30 flex flex-col">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Selection</h2>
              <div className="text-4xl font-black text-green-500 mb-1">{selectedCount}</div>
              <p className="text-sm text-green-400/80 font-medium uppercase tracking-wider">Tracks Selected</p>
            </div>
            
            {/* NEW: Scrollable Selected Tracks List */}
            {selectedCount > 0 && (
              <div className="mt-6 max-h-60 overflow-y-auto space-y-2 pr-2 -mr-2 scrollbar-thin scrollbar-thumb-green-900/50">
                {selectedArray.map(track => (
                  <div key={track.uri} className="flex items-center gap-3 bg-neutral-950/50 p-2 rounded-lg group">
                    {track.album?.images?.[2] ? (
                      <img src={track.album.images[2].url} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center shrink-0">
                        <Music className="w-3 h-3 text-neutral-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{track.name}</p>
                      <p className="text-xs text-neutral-400 truncate">{track.artists?.[0]?.name}</p>
                    </div>
                    <button 
                      onClick={() => toggleSongSelection(track)} 
                      className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                      title="Remove from selection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 relative">
            
            {/* Loading Overlay for Actions */}
            {isLoading && selectedCount > 0 && (
              <div className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl m-4">
                <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
              </div>
            )}

            {/* Create New Playlist */}
            <section>
              <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create New
              </h3>
              <form onSubmit={handleCreateAndAdd} className="flex flex-col gap-3">
                <input 
                  type="text" 
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="New Playlist Name" 
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-green-500 focus:outline-none transition-colors"
                />
                <button 
                  type="submit"
                  disabled={selectedCount === 0 || !newPlaylistName.trim() || isLoading}
                  className="w-full bg-white hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-bold py-3 px-4 rounded-lg transition-colors flex justify-center items-center gap-2"
                >
                  Create & Add
                </button>
              </form>
            </section>

            <div className="h-px bg-neutral-800 w-full rounded-full" />

            {/* Add to Existing Playlist */}
            <section className="flex-1 flex flex-col min-h-0">
              <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                Add to Existing
              </h3>
              
              {playlists.length === 0 ? (
                <p className="text-sm text-neutral-500 italic">No playlists found. Create one above!</p>
              ) : (
                <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-2 -mr-2">
                  {playlists.map(playlist => (
                    <button
                      key={playlist.id}
                      onClick={() => handleAddToExisting(playlist.id, playlist.name)}
                      disabled={selectedCount === 0 || isLoading}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-neutral-800 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      {playlist.images?.[0] ? (
                        <img src={playlist.images[0].url} alt="" className="w-12 h-12 rounded object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-neutral-800 flex items-center justify-center shrink-0">
                          <Music className="w-5 h-5 text-neutral-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{playlist.name}</p>
                        <p className="text-xs text-neutral-400">
                          {playlist.tracks?.total || 0} tracks
                        </p>
                      </div>
                      
                      {/* Hover action indicator */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                        <Plus className="w-5 h-5 text-green-500" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}