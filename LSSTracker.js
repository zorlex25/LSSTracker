// ==UserScript==
// @name         LSSTracker - Complete Player Statistics Tracker
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Complete mission and player statistics tracker with profile verification
// @author       zorlex25
// @match        https://www.leitstellenspiel.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

;(() => {
  // Security check - only run if loaded by authorized loader
  if (!window.lssTrackerAllowedUsers || !window.lssTrackerUserData || !window.lssTrackerGM) {
    console.error("LSSTracker: Unauthorized access attempt")
    return
  }

  const currentUser = window.lssTrackerUserData
  const allowedUsers = window.lssTrackerAllowedUsers
  const GM = window.lssTrackerGM

  // Verify current user is still in allowed list
  if (!allowedUsers.includes(currentUser.userId)) {
    console.error("LSSTracker: User not authorized")
    return
  }

  // Configuration
  const CONFIG = {
    checkInterval: 30000, // 30 seconds
    maxMissions: 10000,
    showNotifications: true,
    maxConcurrentRequests: 3,
    profileCacheTime: 24 * 60 * 60 * 1000, // 24 hours
    missionCacheTime: 60 * 60 * 1000, // 1 hour
  }

  // Data storage
  let trackedMissions = JSON.parse(GM.getValue("lssTrackedMissions", "[]"))
  let processedMissionIds = new Set(trackedMissions.map(m => m.id))
  let playerProfiles = JSON.parse(GM.getValue("lssPlayerProfiles", "{}"))
  let playerStats = JSON.parse(GM.getValue("lssPlayerStats", "{}"))
  let isTracking = GM.getValue("lssIsTracking", false)
  let lastCheck = GM.getValue("lssLastCheck", 0)
  let isMinimized = GM.getValue("lssIsMinimized", false)
  let currentTimeFilter = GM.getValue("lssCurrentTimeFilter", "week")
  
  const processingQueue = []
  let activeRequests = 0

  // Add CSS styles
  GM.addStyle(`
    .lss-tracker-panel {
      position: fixed;
      top: 10px;
      right: 10px;
      width: 400px;
      max-height: 80vh;
      background: #1a1a1a;
      color: #fff;
      border: 2px solid #007bff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 12px;
      overflow: hidden;
    }
    
    .lss-tracker-header {
      background: #007bff;
      padding: 10px 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }
    
    .lss-tracker-content {
      padding: 15px;
      max-height: 70vh;
      overflow-y: auto;
    }
    
    .lss-tracker-minimized .lss-tracker-content {
      display: none;
    }
    
    .lss-tracker-button {
      background: #007bff;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      margin: 2px;
    }
    
    .lss-tracker-button:hover {
      background: #0056b3;
    }
    
    .lss-tracker-button.danger {
      background: #dc3545;
    }
    
    .lss-tracker-button.danger:hover {
      background: #c82333;
    }
    
    .lss-tracker-button.success {
      background: #28a745;
    }
    
    .lss-tracker-button.success:hover {
      background: #218838;
    }
    
    .lss-tracker-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 11px;
    }
    
    .lss-tracker-table th,
    .lss-tracker-table td {
      border: 1px solid #444;
      padding: 4px 6px;
      text-align: left;
    }
    
    .lss-tracker-table th {
      background: #333;
      font-weight: bold;
    }
    
    .lss-tracker-table tr:nth-child(even) {
      background: #2a2a2a;
    }
    
    .lss-tracker-hud {
      position: fixed;
      top: 100px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #00ff00;
      padding: 10px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      z-index: 9999;
      min-width: 200px;
    }
    
    .lss-tracker-tab {
      display: inline-block;
      padding: 8px 12px;
      background: #333;
      color: #fff;
      cursor: pointer;
      border: none;
      margin-right: 2px;
    }
    
    .lss-tracker-tab.active {
      background: #007bff;
    }
    
    .lss-tracker-tab-content {
      display: none;
    }
    
    .lss-tracker-tab-content.active {
      display: block;
    }
    
    .lss-tracker-filter {
      margin: 10px 0;
    }
    
    .lss-tracker-filter select {
      background: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 5px;
      border-radius: 3px;
    }
  `)

  // Enhanced profile verification
  function verifyUserProfile() {
    const profileData = getCurrentUserData()
    
    if (!profileData.userId || profileData.userId !== currentUser.userId) {
      GM.notification({
        text: "Profil-Verifikation fehlgeschlagen! Script wird gestoppt.",
        title: "LSSTracker - Sicherheitswarnung",
        timeout: 5000,
      })
      return false
    }
    
    return true
  }

  // Get current user data
  function getCurrentUserData() {
    let userId = null
    let userName = null

    const profileLink = document.querySelector('a[href^="/profile/"]')
    if (profileLink) {
      const match = profileLink.href.match(/\/profile\/(\d+)/)
      if (match) {
        userId = Number.parseInt(match[1])
        userName = profileLink.textContent.trim()
      }
    }

    if (!userId) {
      const navbarProfile = document.querySelector('#navbar_profile_link')
      if (navbarProfile) {
        const match = navbarProfile.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = navbarProfile.textContent.trim()
        }
      }
    }

    return { userId, userName }
  }

  // Get time filter boundaries
  function getTimeFilterBoundaries(filter) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    switch (filter) {
      case 'day':
        return {
          start: today.getTime(),
          end: now.getTime(),
          label: 'Heute'
        }
      case 'week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 7)
        return {
          start: weekStart.getTime(),
          end: now.getTime(),
          label: 'Letzte 7 Tage'
        }
      case 'month':
        const monthStart = new Date(today)
        monthStart.setDate(today.getDate() - 30)
        return {
          start: monthStart.getTime(),
          end: now.getTime(),
          label: 'Letzte 30 Tage'
        }
      case 'lifetime':
      default:
        return {
          start: 0,
          end: now.getTime(),
          label: 'Gesamtzeit'
        }
    }
  }

  // HTTP request wrapper
  function makeRequest(url) {
    return new Promise((resolve, reject) => {
      GM.xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 10000,
        onload: (response) => {
          if (response.status === 200) {
            resolve(response.responseText)
          } else {
            reject(new Error(`HTTP ${response.status}`))
          }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('Timeout'))
      })
    })
  }

  // Fetch player profile data
  async function fetchPlayerProfile(playerId) {
    if (playerProfiles[playerId] && 
        Date.now() - playerProfiles[playerId].lastUpdated < CONFIG.profileCacheTime) {
      return playerProfiles[playerId]
    }

    try {
      const html = await makeRequest(`https://www.leitstellenspiel.de/profile/${playerId}`)
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      
      const nameElement = doc.querySelector('h1')
      const creditsElement = doc.querySelector('[data-credits-earned]')
      
      const profile = {
        id: playerId,
        name: nameElement ? nameElement.textContent.trim() : `Player ${playerId}`,
        totalCredits: creditsElement ? parseInt(creditsElement.getAttribute('data-credits-earned')) || 0 : 0,
        lastUpdated: Date.now()
      }
      
      playerProfiles[playerId] = profile
      savePlayerProfiles()
      
      return profile
    } catch (error) {
      console.error(`Failed to fetch profile for player ${playerId}:`, error)
      return {
        id: playerId,
        name: `Player ${playerId}`,
        totalCredits: 0,
        lastUpdated: Date.now()
      }
    }
  }

  // Parse mission page for player data
  async function parseMissionPage(missionId, missionUrl) {
    try {
      const html = await makeRequest(missionUrl)
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      
      const missionData = {
        id: missionId,
        url: missionUrl,
        timestamp: Date.now(),
        players: new Set(),
        vehicleParticipants: new Set(),
        credits: 0,
        sharedCredits: 0,
        presenceCredits: 0
      }

      // Extract mission title
      const titleElement = doc.querySelector('h1')
      missionData.title = titleElement ? titleElement.textContent.trim() : `Mission ${missionId}`

      // Extract credits information
      const creditsText = doc.body.textContent
      const creditsMatch = creditsText.match(/(\d+)\s*Credits/)
      if (creditsMatch) {
        missionData.credits = parseInt(creditsMatch[1])
      }

      // Find shared credits
      const sharedMatch = creditsText.match(/Geteilt:\s*(\d+)\s*Credits/i)
      if (sharedMatch) {
        missionData.sharedCredits = parseInt(sharedMatch[1])
      }

      // Extract player information from vehicle assignments
      const vehicleRows = doc.querySelectorAll('tr')
      vehicleRows.forEach(row => {
        const cells = row.querySelectorAll('td')
        if (cells.length >= 2) {
          const vehicleCell = cells[0]
          const playerLink = vehicleCell.querySelector('a[href*="/profile/"]')
          
          if (playerLink) {
            const playerMatch = playerLink.href.match(/\/profile\/(\d+)/)
            if (playerMatch) {
              const playerId = parseInt(playerMatch[1])
              missionData.players.add(playerId)
              missionData.vehicleParticipants.add(playerId)
            }
          }
        }
      })

      // Also check for players in mission chat/comments
      const chatElements = doc.querySelectorAll('.mission_chat_message, .comment')
      chatElements.forEach(element => {
        const playerLink = element.querySelector('a[href*="/profile/"]')
        if (playerLink) {
          const playerMatch = playerLink.href.match(/\/profile\/(\d+)/)
          if (playerMatch) {
            const playerId = parseInt(playerMatch[1])
            missionData.players.add(playerId)
          }
        }
      })

      // Convert Sets to Arrays for storage
      missionData.players = Array.from(missionData.players)
      missionData.vehicleParticipants = Array.from(missionData.vehicleParticipants)

      return missionData
    } catch (error) {
      console.error(`Failed to parse mission ${missionId}:`, error)
      return null
    }
  }

  // Process mission queue
  async function processQueue() {
    if (activeRequests >= CONFIG.maxConcurrentRequests || processingQueue.length === 0) {
      return
    }

    activeRequests++
    const { missionId, missionUrl } = processingQueue.shift()

    try {
      const missionData = await parseMissionPage(missionId, missionUrl)
      if (missionData) {
        trackedMissions.push(missionData)
        processedMissionIds.add(missionId)
        
        // Update player statistics
        await updatePlayerStats(missionData)
        
        saveTrackedMissions()
        updateUI()
        
        showNotification(`Mission ${missionData.title} verarbeitet`, "success")
      }
    } catch (error) {
      console.error(`Error processing mission ${missionId}:`, error)
    } finally {
      activeRequests--
      setTimeout(processQueue, 1000) // Process next item after 1 second
    }
  }

  // Update player statistics
  async function updatePlayerStats(missionData) {
    for (const playerId of missionData.players) {
      if (!playerStats[playerId]) {
        playerStats[playerId] = {
          totalMissions: 0,
          totalSharedCredits: 0,
          totalPresenceCredits: 0,
          vehicleParticipations: 0,
          lastSeen: 0
        }
      }

      const stats = playerStats[playerId]
      stats.totalMissions++
      stats.lastSeen = Math.max(stats.lastSeen, missionData.timestamp)

      // Award shared credits to all participants
      if (missionData.sharedCredits > 0) {
        stats.totalSharedCredits += missionData.sharedCredits
      }

      // Award presence credits (full mission credits to each present player)
      if (missionData.credits > 0) {
        stats.totalPresenceCredits += missionData.credits
      }

      // Track vehicle participation
      if (missionData.vehicleParticipants.includes(playerId)) {
        stats.vehicleParticipations++
      }

      // Fetch player profile for total credits calculation
      await fetchPlayerProfile(playerId)
    }

    GM.setValue("lssPlayerStats", JSON.stringify(playerStats))
  }

  // Calculate statistics for time filter
  function calculateFilteredStats() {
    const { start, end } = getTimeFilterBoundaries(currentTimeFilter)
    const filteredMissions = trackedMissions.filter(m => m.timestamp >= start && m.timestamp <= end)
    
    const stats = {}
    
    filteredMissions.forEach(mission => {
      mission.players.forEach(playerId => {
        if (!stats[playerId]) {
          stats[playerId] = {
            missions: 0,
            sharedCredits: 0,
            presenceCredits: 0,
            vehicleParticipations: 0
          }
        }
        
        stats[playerId].missions++
        stats[playerId].sharedCredits += mission.sharedCredits || 0
        stats[playerId].presenceCredits += mission.credits || 0
        
        if (mission.vehicleParticipants.includes(playerId)) {
          stats[playerId].vehicleParticipations++
        }
      })
    })
    
    return stats
  }

  // Scan for new missions
  async function scanForMissions() {
    if (!verifyUserProfile()) return

    try {
      // Check current page for mission links
      const missionLinks = document.querySelectorAll('a[href*="/missions/"]')
      let newMissions = 0

      missionLinks.forEach(link => {
        const match = link.href.match(/\/missions\/(\d+)/)
        if (match) {
          const missionId = parseInt(match[1])
          if (!processedMissionIds.has(missionId)) {
            processingQueue.push({
              missionId: missionId,
              missionUrl: link.href
            })
            newMissions++
          }
        }
      })

      if (newMissions > 0) {
        showNotification(`${newMissions} neue Missionen gefunden`, "info")
        processQueue()
      }

      // Also scan mission list page if we're on it
      if (window.location.pathname.includes('/missions')) {
        const missionRows = document.querySelectorAll('tr[id^="mission_"]')
        missionRows.forEach(row => {
          const link = row.querySelector('a[href*="/missions/"]')
          if (link) {
            const match = link.href.match(/\/missions\/(\d+)/)
            if (match) {
              const missionId = parseInt(match[1])
              if (!processedMissionIds.has(missionId)) {
                processingQueue.push({
                  missionId: missionId,
                  missionUrl: link.href
                })
                newMissions++
              }
            }
          }
        })
      }

    } catch (error) {
      console.error('Error scanning for missions:', error)
    }
  }

  // Add button to navbar
  function addNavbarButton() {
    if (!verifyUserProfile()) return

    const navbar = document.querySelector('.nav.navbar-nav.navbar-right')
    if (navbar && !document.getElementById('lss-tracker-btn')) {
      const li = document.createElement('li')
      li.innerHTML = `
        <a href="#" id="lss-tracker-btn" title="LSSTracker - Player Statistics">
          <img class="navbar-icon" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTMgM3YxOGgxOFYzSDN6bTIgMmgxNHYxNEg1VjV6bTIgMmg0djJIN3ptMCA0aDR2Mkg3em0wIDRoNHYySDd6Ii8+PC9zdmc+" width="24" height="24">
          <span class="visible-xs">LSSTracker</span>
        </a>
      `
      
      const helpMenu = document.getElementById('help_menu')
      if (helpMenu) {
        navbar.insertBefore(li, helpMenu)
      } else {
        navbar.appendChild(li)
      }
      
      document.getElementById('lss-tracker-btn').addEventListener('click', (e) => {
        e.preventDefault()
        if (verifyUserProfile()) {
          toggleUI()
        }
      })
    }
  }

  // Create HUD display
  function createHUD() {
    const existingHUD = document.getElementById('lss-tracker-hud')
    if (existingHUD) {
      existingHUD.remove()
    }

    const filteredStats = calculateFilteredStats()
    const totalSharedCredits = Object.values(filteredStats).reduce((sum, stats) => sum + stats.sharedCredits, 0)
    const totalMissions = trackedMissions.filter(m => {
      const { start, end } = getTimeFilterBoundaries(currentTimeFilter)
      return m.timestamp >= start && m.timestamp <= end
    }).length

    const hud = document.createElement('div')
    hud.id = 'lss-tracker-hud'
    hud.className = 'lss-tracker-hud'
    hud.innerHTML = `
      <div><strong>📊 LSSTracker HUD</strong></div>
      <div>Status: ${isTracking ? '🟢 Aktiv' : '🔴 Gestoppt'}</div>
      <div>Missionen: ${totalMissions}</div>
      <div>Geteilte Credits: ${totalSharedCredits.toLocaleString()}</div>
      <div>Filter: ${getTimeFilterBoundaries(currentTimeFilter).label}</div>
      <div>Spieler: ${Object.keys(filteredStats).length}</div>
    `

    document.body.appendChild(hud)

    // Make HUD draggable
    let isDragging = false
    let dragOffset = { x: 0, y: 0 }

    hud.addEventListener('mousedown', (e) => {
      isDragging = true
      dragOffset.x = e.clientX - hud.offsetLeft
      dragOffset.y = e.clientY - hud.offsetTop
      hud.style.cursor = 'grabbing'
    })

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        hud.style.left = (e.clientX - dragOffset.x) + 'px'
        hud.style.top = (e.clientY - dragOffset.y) + 'px'
      }
    })

    document.addEventListener('mouseup', () => {
      isDragging = false
      hud.style.cursor = 'grab'
    })
  }

  // Toggle tracking
  function toggleTracking() {
    if (!verifyUserProfile()) return

    isTracking = !isTracking
    GM.setValue("lssIsTracking", isTracking)

    const button = document.getElementById("toggle-tracking")
    const status = document.getElementById("tracking-status")

    if (isTracking) {
      button.textContent = "⏹️ Stop Tracking"
      button.className = "lss-tracker-button danger"
      if (status) status.textContent = "🟢 Aktiv"
      startTracking()
      showNotification("Spielerstatistik-Tracking gestartet!", "success")
    } else {
      button.textContent = "▶️ Start Tracking"
      button.className = "lss-tracker-button success"
      if (status) status.textContent = "🔴 Gestoppt"
      showNotification("Spielerstatistik-Tracking gestoppt!", "info")
    }

    updateUI()
  }

  // Show notification
  function showNotification(message, type = "info") {
    if (!CONFIG.showNotifications) return

    GM.notification({
      text: message,
      title: "LSSTracker",
      timeout: 4000,
    })

    console.log(`[LSSTracker] ${message}`)
  }

  // Save data
  function saveTrackedMissions() {
    GM.setValue("lssTrackedMissions", JSON.stringify(trackedMissions))
  }

  function savePlayerProfiles() {
    GM.setValue("lssPlayerProfiles", JSON.stringify(playerProfiles))
  }

  // Toggle UI visibility
  function toggleUI() {
    const existingPanel = document.getElementById("lss-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
    } else {
      createUI()
    }
  }

  // Update UI
  function updateUI() {
    const panel = document.getElementById("lss-tracker-panel")
    if (panel) {
      panel.remove()
      createUI()
    }

    createHUD()
  }

  // Create main UI panel
  function createUI() {
    const panel = document.createElement("div")
    panel.id = "lss-tracker-panel"
    panel.className = `lss-tracker-panel ${isMinimized ? 'lss-tracker-minimized' : ''}`
    
    const filteredStats = calculateFilteredStats()
    const { label } = getTimeFilterBoundaries(currentTimeFilter)

    panel.innerHTML = `
      <div class="lss-tracker-header">
        <h3 style="margin: 0; color: white;">📊 LSSTracker v2.0</h3>
        <div>
          <button id="minimize-panel" class="lss-tracker-button" style="background: none; border: none; font-size: 16px;">
            ${isMinimized ? '🔼' : '🔽'}
          </button>
          <button id="close-panel" class="lss-tracker-button" style="background: none; border: none; font-size: 16px; color: #ff4444;">
            ✕
          </button>
        </div>
      </div>
      
      <div class="lss-tracker-content">
        <div style="margin-bottom: 15px;">
          <p><strong>Benutzer:</strong> ${currentUser.userName} (ID: ${currentUser.userId})</p>
          <p><strong>Status:</strong> <span id="tracking-status">${isTracking ? "🟢 Aktiv" : "🔴 Gestoppt"}</span></p>
          <p><strong>Missionen:</strong> ${trackedMissions.length} (${Object.keys(filteredStats).length} Spieler aktiv)</p>
          <p><strong>Warteschlange:</strong> ${processingQueue.length} Missionen</p>
        </div>

        <div style="margin-bottom: 15px;">
          <button id="toggle-tracking" class="lss-tracker-button ${isTracking ? 'danger' : 'success'}" style="width: 100%;">
            ${isTracking ? "⏹️ Stop Tracking" : "▶️ Start Tracking"}
          </button>
        </div>

        <div class="lss-tracker-filter">
          <label><strong>Zeitfilter:</strong></label>
          <select id="time-filter">
            <option value="day" ${currentTimeFilter === 'day' ? 'selected' : ''}>Heute</option>
            <option value="week" ${currentTimeFilter === 'week' ? 'selected' : ''}>Letzte 7 Tage</option>
            <option value="month" ${currentTimeFilter === 'month' ? 'selected' : ''}>Letzte 30 Tage</option>
            <option value="lifetime" ${currentTimeFilter === 'lifetime' ? 'selected' : ''}>Gesamtzeit</option>
          </select>
        </div>

        <div style="margin: 15px 0;">
          <button class="lss-tracker-tab active" data-tab="overview">Übersicht</button>
          <button class="lss-tracker-tab" data-tab="players">Spieler</button>
          <button class="lss-tracker-tab" data-tab="missions">Missionen</button>
          <button class="lss-tracker-tab" data-tab="settings">Einstellungen</button>
        </div>

        <div id="tab-overview" class="lss-tracker-tab-content active">
          ${createOverviewTab(filteredStats, label)}
        </div>

        <div id="tab-players" class="lss-tracker-tab-content">
          ${createPlayersTab(filteredStats)}
        </div>

        <div id="tab-missions" class="lss-tracker-tab-content">
          ${createMissionsTab()}
        </div>

        <div id="tab-settings" class="lss-tracker-tab-content">
          ${createSettingsTab()}
        </div>
      </div>
    `

    document.body.appendChild(panel)
    setupEventListeners()
  }

  // Create overview tab
  function createOverviewTab(filteredStats, label) {
    const totalMissions = Object.values(filteredStats).reduce((sum, stats) => sum + stats.missions, 0)
    const totalSharedCredits = Object.values(filteredStats).reduce((sum, stats) => sum + stats.sharedCredits, 0)
    const totalVehicleParticipations = Object.values(filteredStats).reduce((sum, stats) => sum + stats.vehicleParticipations, 0)

    return `
      <h4>📈 Statistiken (${label})</h4>
      <table class="lss-tracker-table">
        <tr><td><strong>Aktive Spieler:</strong></td><td>${Object.keys(filteredStats).length}</td></tr>
        <tr><td><strong>Gesamte Missionen:</strong></td><td>${totalMissions}</td></tr>
        <tr><td><strong>Geteilte Credits:</strong></td><td>${totalSharedCredits.toLocaleString()}</td></tr>
        <tr><td><strong>Fahrzeug-Teilnahmen:</strong></td><td>${totalVehicleParticipations}</td></tr>
        <tr><td><strong>Ø Credits/Mission:</strong></td><td>${totalMissions > 0 ? Math.round(totalSharedCredits / totalMissions).toLocaleString() : 0}</td></tr>
      </table>
    `
  }

  // Create players tab
  function createPlayersTab(filteredStats) {
    const sortedPlayers = Object.entries(filteredStats)
      .map(([playerId, stats]) => ({
        id: playerId,
        name: playerProfiles[playerId]?.name || `Player ${playerId}`,
        totalCredits: playerProfiles[playerId]?.totalCredits || 0,
        ...stats
      }))
      .sort((a, b) => b.sharedCredits - a.sharedCredits)

    let tableRows = ''
    sortedPlayers.forEach(player => {
      const sharePercentage = player.totalCredits > 0 
        ? ((player.sharedCredits / player.totalCredits) * 100).toFixed(1)
        : '0.0'

      tableRows += `
        <tr>
          <td>${player.name}</td>
          <td>${player.missions}</td>
          <td>${player.sharedCredits.toLocaleString()}</td>
          <td>${player.vehicleParticipations}</td>
          <td>${sharePercentage}%</td>
        </tr>
      `
    })

    return `
      <h4>👥 Spielerstatistiken</h4>
      <table class="lss-tracker-table">
        <thead>
          <tr>
            <th>Spieler</th>
            <th>Missionen</th>
            <th>Geteilte Credits</th>
            <th>Fahrzeuge</th>
            <th>Anteil Karriere</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || '<tr><td colspan="5">Keine Daten verfügbar</td></tr>'}
        </tbody>
      </table>
    `
  }

  // Create missions tab
  function createMissionsTab() {
    const { start, end } = getTimeFilterBoundaries(currentTimeFilter)
    const filteredMissions = trackedMissions
      .filter(m => m.timestamp >= start && m.timestamp <= end)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50) // Show last 50 missions

    let tableRows = ''
    filteredMissions.forEach(mission => {
      const date = new Date(mission.timestamp).toLocaleDateString('de-DE')
      const time = new Date(mission.timestamp).toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })

      tableRows += `
        <tr>
          <td>${date} ${time}</td>
          <td><a href="${mission.url}" target="_blank">${mission.title}</a></td>
          <td>${mission.players.length}</td>
          <td>${mission.sharedCredits.toLocaleString()}</td>
        </tr>
      `
    })

    return `
      <h4>🎯 Letzte Missionen</h4>
      <table class="lss-tracker-table">
        <thead>
          <tr>
            <th>Datum/Zeit</th>
            <th>Mission</th>
            <th>Spieler</th>
            <th>Credits</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || '<tr><td colspan="4">Keine Missionen gefunden</td></tr>'}
        </tbody>
      </table>
    `
  }

  // Create settings tab
  function createSettingsTab() {
    return `
      <h4>⚙️ Einstellungen</h4>
      <div style="margin: 10px 0;">
        <label>
          <input type="checkbox" id="show-notifications" ${CONFIG.showNotifications ? 'checked' : ''}> 
          Benachrichtigungen anzeigen
        </label>
      </div>
      <div style="margin: 10px 0;">
        <label>
          <input type="checkbox" id="show-hud" ${document.getElementById('lss-tracker-hud') ? 'checked' : ''}> 
          HUD anzeigen
        </label>
      </div>
      <div style="margin: 15px 0;">
        <button id="export-data" class="lss-tracker-button">📥 Daten exportieren</button>
        <button id="clear-data" class="lss-tracker-button danger">🗑️ Daten löschen</button>
      </div>
      <div style="margin: 15px 0;">
        <button id="scan-missions" class="lss-tracker-button">🔍 Missionen scannen</button>
        <button id="refresh-profiles" class="lss-tracker-button">👤 Profile aktualisieren</button>
      </div>
    `
  }

  // Setup event listeners
  function setupEventListeners() {
    // Panel controls
    document.getElementById("toggle-tracking")?.addEventListener("click", toggleTracking)
    document.getElementById("close-panel")?.addEventListener("click", () => {
      document.getElementById("lss-tracker-panel")?.remove()
    })
    
    document.getElementById("minimize-panel")?.addEventListener("click", () => {
      isMinimized = !isMinimized
      GM.setValue("lssIsMinimized", isMinimized)
      updateUI()
    })

    // Time filter
    document.getElementById("time-filter")?.addEventListener("change", (e) => {
      currentTimeFilter = e.target.value
      GM.setValue("lssCurrentTimeFilter", currentTimeFilter)
      updateUI()
    })

    // Tab switching
    document.querySelectorAll('.lss-tracker-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab')
        
        // Update tab buttons
        document.querySelectorAll('.lss-tracker-tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // Update tab content
        document.querySelectorAll('.lss-tracker-tab-content').forEach(content => {
          content.classList.remove('active')
        })
        document.getElementById(`tab-${tabName}`)?.classList.add('active')
      })
    })

    // Settings
    document.getElementById("show-notifications")?.addEventListener("change", (e) => {
      CONFIG.showNotifications = e.target.checked
    })

    document.getElementById("show-hud")?.addEventListener("change", (e) => {
      if (e.target.checked) {
        createHUD()
      } else {
        document.getElementById('lss-tracker-hud')?.remove()
      }
    })

    document.getElementById("export-data")?.addEventListener("click", exportData)
    document.getElementById("clear-data")?.addEventListener("click", clearData)
    document.getElementById("scan-missions")?.addEventListener("click", scanForMissions)
    document.getElementById("refresh-profiles")?.addEventListener("click", refreshProfiles)
  }

  // Export data
  function exportData() {
    const data = {
      missions: trackedMissions,
      profiles: playerProfiles,
      stats: playerStats,
      exportDate: new Date().toISOString(),
      version: "2.0"
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    
    GM.download(url, `lsstracker-export-${Date.now()}.json`, url)
    showNotification("Daten exportiert!", "success")
  }

  // Clear data
  function clearData() {
    if (confirm("Alle Daten löschen? Diese Aktion kann nicht rückgängig gemacht werden!")) {
      trackedMissions = []
      processedMissionIds.clear()
      playerProfiles = {}
      playerStats = {}
      
      GM.setValue("lssTrackedMissions", "[]")
      GM.setValue("lssPlayerProfiles", "{}")
      GM.setValue("lssPlayerStats", "{}")
      
      updateUI()
      showNotification("Alle Daten gelöscht!", "info")
    }
  }

  // Refresh profiles
  async function refreshProfiles() {
    showNotification("Profile werden aktualisiert...", "info")
    
    const playerIds = Object.keys(playerStats)
    for (const playerId of playerIds) {
      delete playerProfiles[playerId] // Force refresh
      await fetchPlayerProfile(playerId)
      await new Promise(resolve => setTimeout(resolve, 1000)) // Rate limiting
    }
    
    updateUI()
    showNotification("Profile aktualisiert!", "success")
  }

  // Start tracking loop
  function startTracking() {
    if (!isTracking || !verifyUserProfile()) return

    scanForMissions()

    setTimeout(() => {
      if (isTracking) {
        lastCheck = Date.now()
        GM.setValue("lssLastCheck", lastCheck)
        startTracking()
      }
    }, CONFIG.checkInterval)
  }

  // Initialize
  function init() {
    if (!verifyUserProfile()) return

    // Add navbar button on main pages
    if (window.location.pathname === "/" || 
        window.location.pathname === "" || 
        window.location.pathname.includes('/missions')) {
      addNavbarButton()
      
      if (isTracking) {
        startTracking()
      }

      // Create HUD if enabled
      createHUD()

      showNotification(`LSSTracker v2.0 bereit für ${currentUser.userName}`, "info")
    }
  }

  // Periodic security check
  setInterval(() => {
    if (!verifyUserProfile()) {
      isTracking = false
      GM.setValue("lssIsTracking", false)
      const panel = document.getElementById("lss-tracker-panel")
      if (panel) panel.remove()
      
      GM.notification({
        text: "Sicherheitsprüfung fehlgeschlagen - Tracking gestoppt",
        title: "LSSTracker - Sicherheit",
        timeout: 5000,
      })
    }
  }, 60000) // Check every minute

  // Wait for page to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    setTimeout(init, 1000)
  }
})()
