// ==UserScript==
// @name         LSSTracker - Player Statistics Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Track player statistics with profile verification
// @author       zorlex25
// @match        https://www.leitstellenspiel.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// ==/UserScript==

;(() => {
  // Security check - only run if loaded by authorized loader
  if (!window.lssTrackerAllowedUsers || !window.lssTrackerUserData) {
    console.error("LSSTracker: Unauthorized access attempt")
    return
  }

  const currentUser = window.lssTrackerUserData
  const allowedUsers = window.lssTrackerAllowedUsers

  // Verify current user is still in allowed list
  if (!allowedUsers.includes(currentUser.userId)) {
    console.error("LSSTracker: User not authorized")
    return
  }

  // Show welcome message
  GM_notification({
    text: `Willkommen ${currentUser.userName}! LSSTracker ist aktiv.`,
    title: "LSSTracker",
    timeout: 3000,
  })

  // Configuration
  const CONFIG = {
    checkInterval: 30000,
    maxMissions: 10000,
    showNotifications: true,
    maxConcurrentRequests: 3,
  }

  // Mission storage
  let trackedMissions = JSON.parse(window.GM_getValue("lssTrackedMissions", "[]"))
  let processedMissionIds = new Set(trackedMissions.map(m => m.id))
  let playerProfiles = JSON.parse(window.GM_getValue("lssPlayerProfiles", "{}"))
  let isTracking = window.GM_getValue("lssIsTracking", false)
  let lastCheck = window.GM_getValue("lssLastCheck", 0)
  let isMinimized = window.GM_getValue("lssIsMinimized", false)
  let currentTimeFilter = window.GM_getValue("lssCurrentTimeFilter", "week")
  const processingQueue = []
  let activeRequests = 0

  // Enhanced profile verification
  function verifyUserProfile() {
    const profileData = getCurrentUserData()
    
    if (!profileData.userId || profileData.userId !== currentUser.userId) {
      GM_notification({
        text: "Profil-Verifikation fehlgeschlagen! Script wird gestoppt.",
        title: "LSSTracker - Sicherheitswarnung",
        timeout: 5000,
      })
      return false
    }
    
    return true
  }

  // Get current user data (same as in loader)
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

  // Add button to navbar with user verification
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

  // Toggle UI visibility
  function toggleUI() {
    const existingPanel = document.getElementById("lss-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
    } else {
      createUI()
    }
  }

  // Create UI Panel
  function createUI() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const playerStats = calculatePlayerStats(timeFilter)
    const topPlayers = Object.entries(playerStats)
      .sort(([, a], [, b]) => b.totalCredits - a.totalCredits)
      .slice(0, 5)

    const panel = document.createElement("div")
    panel.id = "lss-tracker-panel"
    panel.innerHTML = `
            <div style="
                position: fixed;
                top: 10px;
                right: 10px;
                width: 420px;
                background: #000;
                color: #fff;
                border: 2px solid #007bff;
                border-radius: 8px;
                padding: 15px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8);
                z-index: 10000;
                font-family: Arial, sans-serif;
                font-size: 12px;
                ${isMinimized ? "height: 50px; overflow: hidden;" : ""}
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0; color: #007bff;">📊 LSSTracker</h3>
                    <div>
                        <span style="font-size: 10px; color: #ccc; margin-right: 10px;">User: ${currentUser.userName}</span>
                        <button id="minimize-panel" style="
                            background: none;
                            border: none;
                            font-size: 18px;
                            cursor: pointer;
                            color: #007bff;
                            margin-right: 10px;
                        ">${isMinimized ? "➕" : "➖"}</button>
                        <button id="close-panel" style="
                            background: none;
                            border: none;
                            font-size: 18px;
                            cursor: pointer;
                            color: #ff4444;
                        ">✕</button>
                    </div>
                </div>

                <div id="panel-content" style="${isMinimized ? "display: none;" : ""}">
                    <div style="margin-bottom: 15px;">
                        <button id="toggle-tracking" style="
                            background: ${isTracking ? "#dc3545" : "#28a745"};
                            color: white;
                            border: none;
                            padding: 10px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-right: 8px;
                            font-weight: bold;
                        ">${isTracking ? "⏹️ Stop" : "▶️ Start"} Tracking</button>

                        <button id="export-player-csv" style="
                            background: #17a2b8;
                            color: white;
                            border: none;
                            padding: 10px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">📊 Export Stats</button>
                    </div>

                    <div style="background: #333; color: #fff; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Status:</strong></span>
                            <span id="tracking-status">${isTracking ? "🟢 Aktiv" : "🔴 Gestoppt"}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Zeitfilter:</strong></span>
                            <span id="time-filter-display">${timeFilter.label}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Einsätze gesamt:</strong></span>
                            <span id="mission-count">${trackedMissions.length}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Aktive Spieler:</strong></span>
                            <span id="player-count">${Object.keys(playerStats).length}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Verarbeitung:</strong></span>
                            <span id="processing-count">0</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span><strong>Letzte Prüfung:</strong></span>
                            <span id="last-check">${lastCheck ? new Date(lastCheck).toLocaleTimeString() : "Nie"}</span>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <div style="margin-bottom: 10px;">
                            <strong>📅 Zeitfilter:</strong>
                        </div>
                        <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                            <button id="filter-day" style="
                                background: ${currentTimeFilter === 'day' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">Heute</button>
                            <button id="filter-week" style="
                                background: ${currentTimeFilter === 'week' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">7 Tage</button>
                            <button id="filter-month" style="
                                background: ${currentTimeFilter === 'month' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">30 Tage</button>
                            <button id="filter-lifetime" style="
                                background: ${currentTimeFilter === 'lifetime' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">Gesamt</button>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <button id="view-player-stats" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-right: 8px;
                        ">👁️ Alle Spieler</button>

                        <button id="view-missions" style="
                            background: #6f42c1;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-right: 8px;
                        ">📋 Einsätze</button>

                        <button id="clear-data" style="
                            background: #ffc107;
                            color: black;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                        ">🗑️ Löschen</button>
                    </div>

                    <div style="margin-bottom: 10px;">
                        <strong>🏆 Top Spieler (${timeFilter.label}):</strong>
                    </div>

                    <div id="top-players" style="
                        max-height: 200px;
                        overflow-y: auto;
                        border: 1px solid #555;
                        padding: 8px;
                        background: #222;
                        border-radius: 4px;
                    ">
                        ${
                          topPlayers.length > 0
                            ? topPlayers
                                .map(
                                  ([playerName, stats], index) => `
                            <div style="margin-bottom: 8px; padding: 6px; border-left: 3px solid ${index === 0 ? "#ffd700" : index === 1 ? "#c0c0c0" : index === 2 ? "#cd7f32" : "#007bff"}; background: #444; border-radius: 3px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <div style="font-weight: bold; font-size: 12px; color: #fff;">${index + 1}. ${playerName}</div>
                                        <div style="font-size: 10px; color: #ccc;">
                                            📤 ${stats.missionCount} geteilt | 🚗 ${stats.missionsPresent || 0} anwesend
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-weight: bold; color: #28a745; font-size: 11px;">
                                            💰 ${stats.totalCredits.toLocaleString()}
                                        </div>
                                        <div style="font-size: 9px; color: #17a2b8;">
                                            Wachstum: ${stats.growthPercentage || 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `,
                                )
                                .join("")
                            : '<div style="font-size: 11px; color: #ccc; text-align: center;">Noch keine Spielerdaten...</div>'
                        }
                    </div>
                </div>
            </div>
        `

    document.body.appendChild(panel)
    setupEventListeners()
  }

  // Calculate player statistics with time filtering
  function calculatePlayerStats(timeFilter) {
    const stats = {}

    trackedMissions.forEach((mission) => {
      const missionTime = new Date(mission.timestamp).getTime()
      const inTimeRange = missionTime >= timeFilter.start && missionTime <= timeFilter.end

      if (!inTimeRange && timeFilter.start > 0) return // Skip if outside time range (except for lifetime)

      // Track mission sharing
      const sharedBy = mission.sharedBy || "Unbekanntes Mitglied"
      if (sharedBy !== "Unbekanntes Mitglied") {
        if (!stats[sharedBy]) {
          stats[sharedBy] = {
            missionCount: 0,
            totalCredits: 0,
            missionsPresent: 0,
            presenceCredits: 0,
            missions: [],
            growthPercentage: null,
          }
        }
        stats[sharedBy].missionCount++
        stats[sharedBy].totalCredits += mission.credits || 0
        stats[sharedBy].missions.push(mission)
      }

      // Track vehicle presence
      if (mission.presentPlayers && mission.presentPlayers.length > 0) {
        mission.presentPlayers.forEach(playerName => {
          if (!stats[playerName]) {
            stats[playerName] = {
              missionCount: 0,
              totalCredits: 0,
              missionsPresent: 0,
              presenceCredits: 0,
              missions: [],
              growthPercentage: null,
            }
          }
          stats[playerName].missionsPresent++
          stats[playerName].presenceCredits += mission.credits || 0
        })
      }
    })

    // Calculate growth percentages
    Object.keys(stats).forEach(playerName => {
      const profileData = playerProfiles[playerName]
      if (profileData && profileData.history && profileData.history.length >= 2) {
        const growthPercentage = calculateGrowthPercentage(playerName, stats[playerName].presenceCredits, timeFilter)
        stats[playerName].growthPercentage = growthPercentage
      }
    })

    return stats
  }

  // Calculate what percentage of recent growth came from presence credits
  function calculateGrowthPercentage(playerName, presenceCredits, timeFilter) {
    const profileData = playerProfiles[playerName]
    if (!profileData || !profileData.history || profileData.history.length < 2) {
      return 'N/A'
    }

    // Find the closest historical data points for the time period
    const now = Date.now()
    const periodStart = timeFilter.start

    // Get current total earnings
    const currentEarnings = profileData.totalEarnings || 0

    // Find historical earnings at the start of the period
    let historicalEarnings = currentEarnings
    for (let i = profileData.history.length - 1; i >= 0; i--) {
      const historyEntry = profileData.history[i]
      if (historyEntry.timestamp <= periodStart) {
        historicalEarnings = historyEntry.totalEarnings
        break
      }
    }

    const totalGrowth = currentEarnings - historicalEarnings
    
    if (totalGrowth <= 0) {
      return '0%'
    }

    const percentage = ((presenceCredits / totalGrowth) * 100).toFixed(1)
    return `${percentage}%`
  }

  // Fetch player profile data with history tracking
  function fetchPlayerProfile(playerName, playerId) {
    window.GM_xmlhttpRequest({
      method: "GET",
      url: `https://www.leitstellenspiel.de/profile/${playerId}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      onload: (response) => {
        try {
          const parser = new DOMParser()
          const doc = parser.parseFromString(response.responseText, "text/html")
          
          const userinfoDiv = doc.querySelector('#userinfo[data-credits-earned]')
          if (userinfoDiv) {
            const totalEarnings = parseInt(userinfoDiv.getAttribute('data-credits-earned')) || 0
            const now = Date.now()

            if (!playerProfiles[playerName]) {
              playerProfiles[playerName] = {
                totalEarnings: totalEarnings,
                lastUpdated: now,
                history: []
              }
            }

            // Update current earnings and add to history
            const oldEarnings = playerProfiles[playerName].totalEarnings
            playerProfiles[playerName].totalEarnings = totalEarnings
            playerProfiles[playerName].lastUpdated = now

            // Add to history if earnings changed
            if (oldEarnings !== totalEarnings) {
              playerProfiles[playerName].history.push({
                timestamp: now,
                totalEarnings: totalEarnings
              })

              // Keep only last 100 history entries
              if (playerProfiles[playerName].history.length > 100) {
                playerProfiles[playerName].history = playerProfiles[playerName].history.slice(-100)
              }
            }

            window.GM_setValue("lssPlayerProfiles", JSON.stringify(playerProfiles))
            console.log(`Profil aktualisiert für ${playerName}: ${totalEarnings.toLocaleString()} Credits gesamt`)
          }
        } catch (error) {
          console.error(`Fehler beim Parsen des Profils für ${playerName}:`, error)
        }
      },
      onerror: (error) => {
        console.error(`Fehler beim Laden des Profils für ${playerName}:`, error)
      },
    })
  }

  // Extract player ID from profile links and fetch profiles
  function extractAndFetchPlayerProfiles(html) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    
    const profileLinks = doc.querySelectorAll('a[href*="/profile/"]')
    profileLinks.forEach(link => {
      const href = link.getAttribute('href')
      const playerName = link.textContent.trim()
      const playerIdMatch = href.match(/\/profile\/(\d+)/)
      
      if (playerIdMatch && playerName) {
        const playerId = playerIdMatch[1]
        // Fetch profile data if we don't have it or it's old (older than 1 hour)
        if (!playerProfiles[playerName] || 
            (Date.now() - playerProfiles[playerName].lastUpdated > 60 * 60 * 1000)) {
          setTimeout(() => fetchPlayerProfile(playerName, playerId), Math.random() * 2000)
        }
      }
    })
  }

  // Setup event listeners
  function setupEventListeners() {
    document.getElementById("toggle-tracking").addEventListener("click", toggleTracking)
    document.getElementById("export-player-csv").addEventListener("click", exportPlayerStatsToCSV)
    document.getElementById("clear-data").addEventListener("click", clearData)
    document.getElementById("view-player-stats").addEventListener("click", viewPlayerStats)
    document.getElementById("view-missions").addEventListener("click", viewAllMissions)
    document.getElementById("minimize-panel").addEventListener("click", toggleMinimize)
    document.getElementById("close-panel").addEventListener("click", () => {
      document.getElementById("lss-tracker-panel").remove()
    })

    // Time filter buttons
    document.getElementById("filter-day").addEventListener("click", () => setTimeFilter('day'))
    document.getElementById("filter-week").addEventListener("click", () => setTimeFilter('week'))
    document.getElementById("filter-month").addEventListener("click", () => setTimeFilter('month'))
    document.getElementById("filter-lifetime").addEventListener("click", () => setTimeFilter('lifetime'))
  }

  // Set time filter
  function setTimeFilter(filter) {
    currentTimeFilter = filter
    window.GM_setValue("lssCurrentTimeFilter", filter)
    
    // Recreate UI with new filter
    const existingPanel = document.getElementById("lss-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
      createUI()
    }
  }

  // Toggle minimize
  function toggleMinimize() {
    isMinimized = !isMinimized
    window.GM_setValue("lssIsMinimized", isMinimized)

    const panel = document.getElementById("lss-tracker-panel")
    const content = document.getElementById("panel-content")
    const button = document.getElementById("minimize-panel")

    if (isMinimized) {
      panel.style.height = "50px"
      panel.style.overflow = "hidden"
      content.style.display = "none"
      button.textContent = "➕"
    } else {
      panel.style.height = "auto"
      panel.style.overflow = "visible"
      content.style.display = "block"
      button.textContent = "➖"
    }
  }

  // Toggle tracking
  function toggleTracking() {
    if (!verifyUserProfile()) return

    isTracking = !isTracking
    window.GM_setValue("lssIsTracking", isTracking)

    const button = document.getElementById("toggle-tracking")
    const status = document.getElementById("tracking-status")

    if (isTracking) {
      button.textContent = "⏹️ Stop Tracking"
      button.style.background = "#dc3545"
      status.textContent = "🟢 Aktiv"
      startTracking()
      showNotification("Spielerstatistik-Tracking gestartet!", "success")
    } else {
      button.textContent = "▶️ Start Tracking"
      button.style.background = "#28a745"
      status.textContent = "🔴 Gestoppt"
      showNotification("Spielerstatistik-Tracking gestoppt!", "info")
    }
  }

  // Start tracking missions
  function startTracking() {
    if (!isTracking || !verifyUserProfile()) return

    checkMissions()
    setTimeout(startTracking, CONFIG.checkInterval)
  }

  // Check for new missions
  function checkMissions() {
    try {
      const missionElements = document.querySelectorAll(
        "#mission_list_alliance .missionSideBarEntry:not(.mission_deleted)",
      )
      let newMissionsFound = 0

      missionElements.forEach((element) => {
        const missionId = element.id?.replace("mission_", "") || ""
        if (missionId && !processedMissionIds.has(missionId)) {
          processingQueue.push(missionId)
          processedMissionIds.add(missionId)
          newMissionsFound++
        }
      })

      if (newMissionsFound > 0) {
        showNotification(`${newMissionsFound} neue(r) Einsatz/Einsätze gefunden! Verarbeitung...`, "info")
        processQueue()
      }

      lastCheck = Date.now()
      window.GM_setValue("lssLastCheck", lastCheck)
      const lastCheckElement = document.getElementById("last-check")
      if (lastCheckElement) {
        lastCheckElement.textContent = new Date(lastCheck).toLocaleTimeString()
      }
    } catch (error) {
      console.error("Fehler beim Prüfen der Einsätze:", error)
    }
  }

  // Process mission queue
  function processQueue() {
    while (processingQueue.length > 0 && activeRequests < CONFIG.maxConcurrentRequests) {
      const missionId = processingQueue.shift()
      processMission(missionId)
    }
    updateProcessingCount()
  }

  // Process individual mission
  function processMission(missionId) {
    activeRequests++
    updateProcessingCount()

    const basicData = getBasicMissionData(missionId)

    window.GM_xmlhttpRequest({
      method: "GET",
      url: `https://www.leitstellenspiel.de/missions/${missionId}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      onload: (response) => {
        try {
          extractAndFetchPlayerProfiles(response.responseText)
          
          const missionData = parseDetailedMissionData(response.responseText, missionId, basicData)
          if (missionData && missionData.sharedBy !== "Unbekanntes Mitglied") {
            trackedMissions.unshift(missionData)

            if (trackedMissions.length > CONFIG.maxMissions) {
              trackedMissions = trackedMissions.slice(0, CONFIG.maxMissions)
            }

            window.GM_setValue("lssTrackedMissions", JSON.stringify(trackedMissions))
            updateUI()
            
            const presentCount = missionData.presentPlayers ? missionData.presentPlayers.length : 0
            showNotification(
              `✅ ${missionData.sharedBy}: ${missionData.credits.toLocaleString()} Credits | ${presentCount} Spieler anwesend`, 
              "success"
            )
          }
        } catch (error) {
          console.error("Fehler beim Parsen der Einsatzdaten:", error)
        }

        activeRequests--
        updateProcessingCount()
        processQueue()
      },
      onerror: (error) => {
        console.error("Fehler beim Laden der Einsatzdetails:", error)
        activeRequests--
        updateProcessingCount()
        processQueue()
      },
    })
  }

  // Get basic mission data from main page
  function getBasicMissionData(missionId) {
    try {
      const element = document.getElementById(`mission_${missionId}`)
      if (!element) return {}

      let name = "Unbekannter Einsatz"
      let address = "Unbekannte Adresse"

      try {
        const nameElement = element.querySelector(`#mission_caption_${missionId}`)
        if (nameElement) name = nameElement.textContent.trim()
      } catch (e) {}

      try {
        const addressElement = element.querySelector(`#mission_address_${missionId}`)
        if (addressElement) address = addressElement.textContent.trim()
      } catch (e) {}

      return { name, address }
    } catch (error) {
      return {}
    }
  }

  // Parse detailed mission data from mission page HTML
  function parseDetailedMissionData(html, missionId, basicData) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, "text/html")

      // Extract shared by from alert div
      let sharedBy = "Unbekanntes Mitglied"
      const alertDivs = doc.querySelectorAll(".alert.alert-info")
      for (const div of alertDivs) {
        const text = div.textContent
        if (text.includes("freigegeben") || text.includes("wurde von")) {
          const profileLink = div.querySelector('a[href*="/profile/"]')
          if (profileLink) {
            sharedBy = profileLink.textContent.trim()
            break
          }
        }
      }

      // Extract present players from the vehicle table
      const presentPlayers = new Set()
      const vehicleTable = doc.querySelector("#mission_vehicle_at_mission")
      if (vehicleTable) {
        const vehicleRows = vehicleTable.querySelectorAll("tbody tr")
        vehicleRows.forEach(row => {
          const ownerLinks = row.querySelectorAll('a[href*="/profile/"]')
          ownerLinks.forEach(link => {
            const playerName = link.textContent.trim()
            if (playerName && playerName !== sharedBy) {
              presentPlayers.add(playerName)
            }
          })
        })
      }

      // Get credits from help page
      const credits = 5000
      const helpLink = doc.querySelector("#mission_help")
      if (helpLink) {
        const helpUrl = helpLink.getAttribute("href")
        if (helpUrl) {
          fetchCreditsFromHelpPage(helpUrl, missionId)
        }
      }

      return {
        id: missionId,
        name: basicData.name || "Unbekannter Einsatz",
        address: basicData.address || "Unbekannte Adresse",
        sharedBy: sharedBy,
        credits: credits,
        presentPlayers: Array.from(presentPlayers),
        timestamp: new Date().toISOString(),
        url: `https://www.leitstellenspiel.de/missions/${missionId}`,
      }
    } catch (error) {
      console.error("Fehler beim Parsen der detaillierten Einsatzdaten:", error)
      return null
    }
  }

  // Fetch credits from help page
  function fetchCreditsFromHelpPage(helpUrl, missionId) {
    window.GM_xmlhttpRequest({
      method: "GET",
      url: `https://www.leitstellenspiel.de${helpUrl}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      onload: (response) => {
        try {
          const parser = new DOMParser()
          const doc = parser.parseFromString(response.responseText, "text/html")

          const rows = doc.querySelectorAll("table.table-striped tbody tr")
          let credits = 5000

          rows.forEach((row) => {
            const cells = row.querySelectorAll("td")
            if (cells.length >= 2) {
              const label = cells[0].textContent.trim()
              if (label.includes("Credits im Durchschnitt")) {
                const creditText = cells[1].textContent.trim()
                const creditMatch = creditText.match(/(\d+)/)
                if (creditMatch) {
                  credits = Number.parseInt(creditMatch[1])
                }
              }
            }
          })

          const mission = trackedMissions.find((m) => m.id === missionId)
          if (mission) {
            mission.credits = credits
            window.GM_setValue("lssTrackedMissions", JSON.stringify(trackedMissions))
            updateUI()
          }
        } catch (error) {
          console.error("Fehler beim Parsen der Credits:", error)
        }
      },
      onerror: () => {
        console.log("Fehler beim Laden der Credits für Einsatz", missionId)
      },
    })
  }

  // Export Player Statistics to CSV
  function exportPlayerStatsToCSV() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const playerStats = calculatePlayerStats(timeFilter)
    const players = Object.entries(playerStats).sort(([, a], [, b]) => 
      b.totalCredits - a.totalCredits
    )

    if (players.length === 0) {
      showNotification("Keine Spielerstatistiken zum Exportieren!", "warning")
      return
    }

    try {
      const headers = [
        "Spielername",
        "Einsätze geteilt",
        "Einsätze anwesend", 
        "Share Credits",
        "Anwesenheits Credits",
        "Wachstum % durch Anwesenheit",
      ]

      const csvRows = [headers.join(",")]

      players.forEach(([playerName, stats]) => {
        const row = [
          `"${playerName}"`, 
          stats.missionCount, 
          stats.missionsPresent || 0,
          stats.totalCredits,
          stats.presenceCredits || 0,
          stats.growthPercentage || "N/A"
        ]
        csvRows.push(row.join(","))
      })

      const csvContent = csvRows.join("\n")
      const filename = `lss_tracker_spieler_stats_${currentTimeFilter}_${new Date().toISOString().split("T")[0]}.csv`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.href = url
      link.download = filename
      link.style.display = "none"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      showNotification(`✅ ${timeFilter.label} Statistiken für ${players.length} Spieler exportiert!`, "success")
    } catch (error) {
      console.error("CSV Export Fehler:", error)
      showNotification("❌ CSV Export fehlgeschlagen! Siehe Konsole für Details.", "error")
    }
  }

  // View Player Statistics
  function viewPlayerStats() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const playerStats = calculatePlayerStats(timeFilter)
    const players = Object.entries(playerStats).sort(([, a], [, b]) => 
      b.totalCredits - a.totalCredits
    )

    const popup = window.open("", "playerstats", "width=1200,height=800,scrollbars=yes")
    popup.document.write(`
            <html>
                <head>
                    <title>Spielerstatistiken - ${players.length} Spieler (${timeFilter.label})</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; background: #000; color: #fff; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #555; }
                        th { background-color: #333; font-weight: bold; position: sticky; top: 0; cursor: pointer; }
                        th:hover { background-color: #444; }
                        tr:hover { background-color: #222; }
                        .credits { font-weight: bold; color: #28a745; }
                        .presence-credits { font-weight: bold; color: #17a2b8; }
                        .player-name { font-weight: bold; color: #007bff; }
                        .stats { background: #333; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                        .rank { font-weight: bold; }
                        .percentage { font-weight: bold; color: #ffc107; }
                        .no-data { color: #666; font-style: italic; }
                    </style>
                </head>
                <body>
                    <div class="stats">
                        <h2>🏆 Spielerstatistiken (${timeFilter.label})</h2>
                        <p><strong>Spieler gesamt:</strong> ${players.length}</p>
                        <p><strong>Einsätze gesamt:</strong> ${trackedMissions.length}</p>
                        <p><strong>Zeitraum:</strong> ${timeFilter.label}</p>
                        <p><strong>Benutzer:</strong> ${currentUser.userName} (ID: ${currentUser.userId})</p>
                    </div>

                    <table id="playerTable">
                        <thead>
                            <tr>
                                <th>Rang</th>
                                <th>Spielername</th>
                                <th>Einsätze geteilt</th>
                                <th>Einsätze anwesend</th>
                                <th>Share Credits</th>
                                <th>Anwesenheits Credits</th>
                                <th>Wachstum % durch Anwesenheit</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${players
                              .map(
                                ([playerName, stats], index) => {
                                  return `
                                <tr>
                                    <td class="rank">#${index + 1}</td>
                                    <td class="player-name">${playerName}</td>
                                    <td>${stats.missionCount}</td>
                                    <td>${stats.missionsPresent || 0}</td>
                                    <td class="credits">${stats.totalCredits.toLocaleString()}</td>
                                    <td class="presence-credits">${(stats.presenceCredits || 0).toLocaleString()}</td>
                                    <td class="${stats.growthPercentage !== 'N/A' ? 'percentage' : 'no-data'}">
                                        ${stats.growthPercentage || 'N/A'}
                                    </td>
                                </tr>
                            `}
                              )
                              .join("")}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 20px; padding: 10px; background: #333; border-radius: 5px;">
                        <small><strong>Wachstum % durch Anwesenheit:</strong> Zeigt, welcher Prozentsatz des gesamten Credit-Wachstums eines Spielers im ausgewählten Zeitraum durch die Anwesenheit bei Verbandseinsätzen mit Fahrzeugen entstanden ist.</small>
                    </div>
                </body>
            </html>
        `)
  }

  // View all missions
  function viewAllMissions() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const filteredMissions = trackedMissions.filter(mission => {
      const missionTime = new Date(mission.timestamp).getTime()
      return timeFilter.start === 0 || (missionTime >= timeFilter.start && missionTime <= timeFilter.end)
    })

    const popup = window.open("", "missions", "width=1400,height=800,scrollbars=yes")
    const totalCredits = filteredMissions.reduce((sum, m) => sum + (m.credits || 0), 0)

    popup.document.write(`
            <html>
                <head>
                    <title>Verfolgte Einsätze - ${filteredMissions.length} Gesamt (${timeFilter.label})</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; background: #000; color: #fff; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #555; }
                        th { background-color: #333; font-weight: bold; position: sticky; top: 0; }
                        tr:hover { background-color: #222; }
                        .credits { font-weight: bold; color: #28a745; }
                        .timestamp { font-size: 0.9em; color: #ccc; }
                        .shared-by { font-weight: bold; color: #007bff; }
                        .present-players { font-size: 0.8em; color: #17a2b8; }
                        .stats { background: #333; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                    </style>
                </head>
                <body>
                    <div class="stats">
                        <h2>📋 Verfolgte Einsätze (${timeFilter.label})</h2>
                        <p><strong>Gefilterte Einsätze:</strong> ${filteredMissions.length}</p>
                        <p><strong>Credits gesamt:</strong> ${totalCredits.toLocaleString()}</p>
                        <p><strong>Benutzer:</strong> ${currentUser.userName} (ID: ${currentUser.userId})</p>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Zeit</th>
                                <th>Einsatz</th>
                                <th>Adresse</th>
                                <th>Geteilt von</th>
                                <th>Credits</th>
                                <th>Anwesende Spieler</th>
                                <th>Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredMissions
                              .map(
                                (mission) => `
                                <tr>
                                    <td class="timestamp">${new Date(mission.timestamp).toLocaleString()}</td>
                                    <td><strong>${mission.name}</strong></td>
                                    <td>${mission.address}</td>
                                    <td class="shared-by">${mission.sharedBy}</td>
                                    <td class="credits">${(mission.credits || 0).toLocaleString()}</td>
                                    <td class="present-players">
                                        ${mission.presentPlayers && mission.presentPlayers.length > 0 ? 
                                          `${mission.presentPlayers.length} Spieler: ${mission.presentPlayers.slice(0, 3).join(', ')}${mission.presentPlayers.length > 3 ? '...' : ''}` : 
                                          'Keine Spieler anwesend'
                                        }
                                    </td>
                                    <td><a href="${mission.url}" target="_blank">Öffnen</a></td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </body>
            </html>
        `)
  }

  // Update processing count display
  function updateProcessingCount() {
    const element = document.getElementById("processing-count")
    if (element) {
      element.textContent = `${activeRequests} aktiv, ${processingQueue.length} in Warteschlange`
    }
  }

  // Clear all data
  function clearData() {
    if (confirm("Sind Sie sicher, dass Sie alle verfolgten Daten löschen möchten?")) {
      trackedMissions = []
      processedMissionIds.clear()
      playerProfiles = {}
      window.GM_setValue("lssTrackedMissions", "[]")
      window.GM_setValue("lssPlayerProfiles", "{}")
      updateUI()
      showNotification("Alle Daten gelöscht!", "info")
    }
  }

  // Update UI
  function updateUI() {
    const panel = document.getElementById("lss-tracker-panel")
    if (panel) {
      const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
      const playerStats = calculatePlayerStats(timeFilter)
      
      const missionCountEl = document.getElementById("mission-count")
      const playerCountEl = document.getElementById("player-count")
      const timeFilterEl = document.getElementById("time-filter-display")
      
      if (missionCountEl) missionCountEl.textContent = trackedMissions.length
      if (playerCountEl) playerCountEl.textContent = Object.keys(playerStats).length
      if (timeFilterEl) timeFilterEl.textContent = timeFilter.label
      
      const topPlayersEl = document.getElementById("top-players")
      if (topPlayersEl) {
        const topPlayers = Object.entries(playerStats)
          .sort(([, a], [, b]) => b.totalCredits - a.totalCredits)
          .slice(0, 5)
          
        topPlayersEl.innerHTML = topPlayers.length > 0
          ? topPlayers.map(([playerName, stats], index) => `
              <div style="margin-bottom: 8px; padding: 6px; border-left: 3px solid ${index === 0 ? "#ffd700" : index === 1 ? "#c0c0c0" : index === 2 ? "#cd7f32" : "#007bff"}; background: #444; border-radius: 3px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                          <div style="font-weight: bold; font-size: 12px; color: #fff;">${index + 1}. ${playerName}</div>
                          <div style="font-size: 10px; color: #ccc;">
                              📤 ${stats.missionCount} geteilt | 🚗 ${stats.missionsPresent || 0} anwesend
                          </div>
                      </div>
                      <div style="text-align: right;">
                          <div style="font-weight: bold; color: #28a745; font-size: 11px;">
                              💰 ${stats.totalCredits.toLocaleString()}
                          </div>
                          <div style="font-size: 9px; color: #17a2b8;">
                              Wachstum: ${stats.growthPercentage || 'N/A'}
                          </div>
                      </div>
                  </div>
              </div>
            `).join("")
          : '<div style="font-size: 11px; color: #ccc; text-align: center;">Noch keine Spielerdaten...</div>'
      }
    }
  }

  // Show notification
  function showNotification(message, type = "info") {
    if (!CONFIG.showNotifications) return

    GM_notification({
      text: message,
      title: "LSSTracker",
      timeout: 4000,
    })

    console.log(`[LSSTracker] ${message}`)
  }

  // Initialize with security checks
  function init() {
    if (!verifyUserProfile()) return

    if (window.location.pathname === "/" || window.location.pathname === "") {
      addNavbarButton()

      if (isTracking) {
        startTracking()
      }

      showNotification(`LSSTracker bereit für ${currentUser.userName}`, "info")
    }
  }

  // Periodic security check
  setInterval(() => {
    if (!verifyUserProfile()) {
      isTracking = false
      window.GM_setValue("lssIsTracking", false)
      const panel = document.getElementById("lss-tracker-panel")
      if (panel) panel.remove()
      
      GM_notification({
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
    init()
  }
})()
