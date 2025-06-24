// ==UserScript==
// @name         Leitstellenspiel Player Statistics Tracker
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  Track player statistics - missions shared, vehicle presence, and growth analysis
// @author       You
// @match        https://www.leitstellenspiel.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// ==/UserScript==

;(() => {
  // Configuration
  const CONFIG = {
    checkInterval: 30000,
    maxMissions: 10000,
    showNotifications: true,
    maxConcurrentRequests: 3,
  }

  // Mission storage
  let trackedMissions = JSON.parse(window.GM_getValue("trackedMissions", "[]"))
  let processedMissionIds = new Set(trackedMissions.map(m => m.id))
  let playerProfiles = JSON.parse(window.GM_getValue("playerProfiles", "{}")) // Cache player profile data with history
  let isTracking = window.GM_getValue("isTracking", false)
  let lastCheck = window.GM_getValue("lastCheck", 0)
  let isMinimized = window.GM_getValue("isMinimized", false)
  let currentTimeFilter = window.GM_getValue("currentTimeFilter", "week") // day, week, month, lifetime
  const processingQueue = []
  let activeRequests = 0

  // Add button to navbar
  function addNavbarButton() {
    const navbar = document.querySelector('.nav.navbar-nav.navbar-right')
    if (navbar && !document.getElementById('player-stats-btn')) {
      const li = document.createElement('li')
      li.innerHTML = `
        <a href="#" id="player-stats-btn" title="Player Statistics Tracker">
          <img class="navbar-icon" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTMgM3YxOGgxOFYzSDN6bTIgMmgxNHYxNEg1VjV6bTIgMmg0djJIN3ptMCA0aDR2Mkg3em0wIDRoNHYySDd6Ii8+PC9zdmc+" width="24" height="24">
          <span class="visible-xs">Stats</span>
        </a>
      `
      
      const helpMenu = document.getElementById('help_menu')
      if (helpMenu) {
        navbar.insertBefore(li, helpMenu)
      } else {
        navbar.appendChild(li)
      }
      
      document.getElementById('player-stats-btn').addEventListener('click', (e) => {
        e.preventDefault()
        toggleUI()
      })
    }
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
          label: 'Today'
        }
      case 'week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 7)
        return {
          start: weekStart.getTime(),
          end: now.getTime(),
          label: 'Last 7 Days'
        }
      case 'month':
        const monthStart = new Date(today)
        monthStart.setDate(today.getDate() - 30)
        return {
          start: monthStart.getTime(),
          end: now.getTime(),
          label: 'Last 30 Days'
        }
      case 'lifetime':
      default:
        return {
          start: 0,
          end: now.getTime(),
          label: 'All Time'
        }
    }
  }

  // Toggle UI visibility
  function toggleUI() {
    const existingPanel = document.getElementById("mission-tracker-panel")
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
    panel.id = "mission-tracker-panel"
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
                    <h3 style="margin: 0; color: #007bff;">📊 Player Statistics Tracker</h3>
                    <div>
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
                            <span id="tracking-status">${isTracking ? "🟢 Active" : "🔴 Stopped"}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Time Filter:</strong></span>
                            <span id="time-filter-display">${timeFilter.label}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Total Missions:</strong></span>
                            <span id="mission-count">${trackedMissions.length}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Active Players:</strong></span>
                            <span id="player-count">${Object.keys(playerStats).length}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Processing:</strong></span>
                            <span id="processing-count">0</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span><strong>Last Check:</strong></span>
                            <span id="last-check">${lastCheck ? new Date(lastCheck).toLocaleTimeString() : "Never"}</span>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <div style="margin-bottom: 10px;">
                            <strong>📅 Time Filter:</strong>
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
                            ">Today</button>
                            <button id="filter-week" style="
                                background: ${currentTimeFilter === 'week' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">7 Days</button>
                            <button id="filter-month" style="
                                background: ${currentTimeFilter === 'month' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">30 Days</button>
                            <button id="filter-lifetime" style="
                                background: ${currentTimeFilter === 'lifetime' ? '#007bff' : '#6c757d'};
                                color: white;
                                border: none;
                                padding: 6px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                            ">All Time</button>
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
                        ">👁️ View All Players</button>

                        <button id="view-missions" style="
                            background: #6f42c1;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-right: 8px;
                        ">📋 View Missions</button>

                        <button id="clear-data" style="
                            background: #ffc107;
                            color: black;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                        ">🗑️ Clear</button>
                    </div>

                    <div style="margin-bottom: 10px;">
                        <strong>🏆 Top Players (${timeFilter.label}):</strong>
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
                                            📤 ${stats.missionCount} shared | 🚗 ${stats.missionsPresent || 0} present
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-weight: bold; color: #28a745; font-size: 11px;">
                                            💰 ${stats.totalCredits.toLocaleString()}
                                        </div>
                                        <div style="font-size: 9px; color: #17a2b8;">
                                            Growth: ${stats.growthPercentage || 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `,
                                )
                                .join("")
                            : '<div style="font-size: 11px; color: #ccc; text-align: center;">No player data yet...</div>'
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
      const sharedBy = mission.sharedBy || "Unknown Member"
      if (sharedBy !== "Unknown Member") {
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

            window.GM_setValue("playerProfiles", JSON.stringify(playerProfiles))
            console.log(`Updated profile for ${playerName}: ${totalEarnings.toLocaleString()} total credits`)
          }
        } catch (error) {
          console.error(`Error parsing profile for ${playerName}:`, error)
        }
      },
      onerror: (error) => {
        console.error(`Error fetching profile for ${playerName}:`, error)
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
      document.getElementById("mission-tracker-panel").remove()
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
    window.GM_setValue("currentTimeFilter", filter)
    
    // Recreate UI with new filter
    const existingPanel = document.getElementById("mission-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
      createUI()
    }
  }

  // Toggle minimize
  function toggleMinimize() {
    isMinimized = !isMinimized
    window.GM_setValue("isMinimized", isMinimized)

    const panel = document.getElementById("mission-tracker-panel")
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
    isTracking = !isTracking
    window.GM_setValue("isTracking", isTracking)

    const button = document.getElementById("toggle-tracking")
    const status = document.getElementById("tracking-status")

    if (isTracking) {
      button.textContent = "⏹️ Stop Tracking"
      button.style.background = "#dc3545"
      status.textContent = "🟢 Active"
      startTracking()
      showNotification("Player statistics tracking started!", "success")
    } else {
      button.textContent = "▶️ Start Tracking"
      button.style.background = "#28a745"
      status.textContent = "🔴 Stopped"
      showNotification("Player statistics tracking stopped!", "info")
    }
  }

  // Start tracking missions
  function startTracking() {
    if (!isTracking) return

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
        showNotification(`Found ${newMissionsFound} new mission(s)! Processing...`, "info")
        processQueue()
      }

      lastCheck = Date.now()
      window.GM_setValue("lastCheck", lastCheck)
      const lastCheckElement = document.getElementById("last-check")
      if (lastCheckElement) {
        lastCheckElement.textContent = new Date(lastCheck).toLocaleTimeString()
      }
    } catch (error) {
      console.error("Error checking missions:", error)
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
          if (missionData && missionData.sharedBy !== "Unknown Member") {
            trackedMissions.unshift(missionData)

            if (trackedMissions.length > CONFIG.maxMissions) {
              trackedMissions = trackedMissions.slice(0, CONFIG.maxMissions)
            }

            window.GM_setValue("trackedMissions", JSON.stringify(trackedMissions))
            updateUI()
            
            const presentCount = missionData.presentPlayers ? missionData.presentPlayers.length : 0
            showNotification(
              `✅ ${missionData.sharedBy}: ${missionData.credits.toLocaleString()} credits | ${presentCount} players present`, 
              "success"
            )
          }
        } catch (error) {
          console.error("Error parsing mission data:", error)
        }

        activeRequests--
        updateProcessingCount()
        processQueue()
      },
      onerror: (error) => {
        console.error("Error fetching mission details:", error)
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

      let name = "Unknown Mission"
      let address = "Unknown Address"

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
      let sharedBy = "Unknown Member"
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
        name: basicData.name || "Unknown Mission",
        address: basicData.address || "Unknown Address",
        sharedBy: sharedBy,
        credits: credits,
        presentPlayers: Array.from(presentPlayers),
        timestamp: new Date().toISOString(),
        url: `https://www.leitstellenspiel.de/missions/${missionId}`,
      }
    } catch (error) {
      console.error("Error parsing detailed mission data:", error)
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
            window.GM_setValue("trackedMissions", JSON.stringify(trackedMissions))
            updateUI()
          }
        } catch (error) {
          console.error("Error parsing credits:", error)
        }
      },
      onerror: () => {
        console.log("Failed to fetch credits for mission", missionId)
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
      showNotification("No player statistics to export!", "warning")
      return
    }

    try {
      const headers = [
        "Player Name",
        "Missions Shared",
        "Missions Present", 
        "Share Credits",
        "Presence Credits",
        "Growth % from Presence",
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
      const filename = `leitstellenspiel_player_stats_${currentTimeFilter}_${new Date().toISOString().split("T")[0]}.csv`

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

      showNotification(`✅ Exported ${timeFilter.label} statistics for ${players.length} players!`, "success")
    } catch (error) {
      console.error("CSV Export Error:", error)
      showNotification("❌ CSV export failed! Check console for details.", "error")
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
                    <title>Player Statistics - ${players.length} Players (${timeFilter.label})</title>
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
                        <h2>🏆 Player Statistics (${timeFilter.label})</h2>
                        <p><strong>Total Players:</strong> ${players.length}</p>
                        <p><strong>Total Missions:</strong> ${trackedMissions.length}</p>
                        <p><strong>Time Period:</strong> ${timeFilter.label}</p>
                    </div>

                    <table id="playerTable">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Player Name</th>
                                <th>Missions Shared</th>
                                <th>Missions Present</th>
                                <th>Share Credits</th>
                                <th>Presence Credits</th>
                                <th>Growth % from Presence</th>
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
                        <small><strong>Growth % from Presence:</strong> Shows what percentage of a player's total credit growth in the selected time period came from being present at alliance missions with vehicles.</small>
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
                    <title>Tracked Missions - ${filteredMissions.length} Total (${timeFilter.label})</title>
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
                        <h2>📋 Tracked Missions (${timeFilter.label})</h2>
                        <p><strong>Filtered Missions:</strong> ${filteredMissions.length}</p>
                        <p><strong>Total Credits:</strong> ${totalCredits.toLocaleString()}</p>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Mission</th>
                                <th>Address</th>
                                <th>Shared By</th>
                                <th>Credits</th>
                                <th>Present Players</th>
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
                                          `${mission.presentPlayers.length} players: ${mission.presentPlayers.slice(0, 3).join(', ')}${mission.presentPlayers.length > 3 ? '...' : ''}` : 
                                          'No players present'
                                        }
                                    </td>
                                    <td><a href="${mission.url}" target="_blank">Open</a></td>
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
      element.textContent = `${activeRequests} active, ${processingQueue.length} queued`
    }
  }

  // Clear all data
  function clearData() {
    if (confirm("Are you sure you want to clear all tracked data?")) {
      trackedMissions = []
      processedMissionIds.clear()
      playerProfiles = {}
      window.GM_setValue("trackedMissions", "[]")
      window.GM_setValue("playerProfiles", "{}")
      updateUI()
      showNotification("All data cleared!", "info")
    }
  }

  // Update UI
  function updateUI() {
    const panel = document.getElementById("mission-tracker-panel")
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
                              📤 ${stats.missionCount} shared | 🚗 ${stats.missionsPresent || 0} present
                          </div>
                      </div>
                      <div style="text-align: right;">
                          <div style="font-weight: bold; color: #28a745; font-size: 11px;">
                              💰 ${stats.totalCredits.toLocaleString()}
                          </div>
                          <div style="font-size: 9px; color: #17a2b8;">
                              Growth: ${stats.growthPercentage || 'N/A'}
                          </div>
                      </div>
                  </div>
              </div>
            `).join("")
          : '<div style="font-size: 11px; color: #ccc; text-align: center;">No player data yet...</div>'
      }
    }
  }

  // Show notification
  function showNotification(message, type = "info") {
    if (!CONFIG.showNotifications) return

    window.GM_notification({
      text: message,
      title: "Player Statistics Tracker",
      timeout: 4000,
    })

    console.log(`[Player Statistics Tracker] ${message}`)
  }

  // Initialize when page loads
  function init() {
    if (window.location.pathname === "/" || window.location.pathname === "") {
      addNavbarButton()

      if (isTracking) {
        startTracking()
      }

      showNotification("Player Statistics Tracker loaded!", "info")
    }
  }

  // Wait for page to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
