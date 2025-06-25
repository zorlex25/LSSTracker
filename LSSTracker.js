// ==UserScript==
// @name         LSSTracker - Smart Mission Completion Detection
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Complete mission tracker with smart completion detection and data preservation
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
    checkInterval: 30000, // Check for new missions every 30 seconds
    rescanInterval: 1200000, // Rescan existing missions every 60 seconds
    maxMissions: 10000,
    showNotifications: true,
    maxConcurrentRequests: 5,
    rescanActiveHours: 6, // Only rescan missions from last 6 hours
    completedMissionRetentionDays: 30, // Keep completed missions for 30 days
  }

  // Mission storage
  let trackedMissions = JSON.parse(GM.getValue("trackedMissions", "[]"))
  let processedMissionIds = new Set(trackedMissions.map(m => m.id))
  let playerProfiles = JSON.parse(GM.getValue("playerProfiles", "{}"))
  let completedMissions = new Set(JSON.parse(GM.getValue("completedMissions", "[]")))
  let isTracking = GM.getValue("isTracking", false)
  let lastCheck = GM.getValue("lastCheck", 0)
  let lastRescan = GM.getValue("lastRescan", 0)
  let isMinimized = GM.getValue("isMinimized", false)
  let currentTimeFilter = GM.getValue("currentTimeFilter", "week")
  const processingQueue = []
  const rescanQueue = []
  let activeRequests = 0
  let rescanRequests = 0

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

  // Check if mission is completed based on HTML content
  function isMissionCompleted(html) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    
    // Check for completion indicators
    const completionIndicators = [
      '.mission-success-image',
      '.mission-success-text',
      'img[alt*="Checkmark mission complete"]',
      'img[src*="checkmark_mission_complete"]'
    ]
    
    for (const selector of completionIndicators) {
      if (doc.querySelector(selector)) {
        return true
      }
    }
    
    // Check for text indicators
    const bodyText = doc.body ? doc.body.textContent : html
    const completionTexts = [
      'The mission was successfully completed',
      'Die Mission wurde erfolgreich abgeschlossen',
      'Mission erfolgreich abgeschlossen',
      'successfully completed'
    ]
    
    return completionTexts.some(text => bodyText.includes(text))
  }

  // Mark mission as completed and remove from rescan queue
  function markMissionCompleted(missionId, reason = "completed") {
    if (!completedMissions.has(missionId)) {
      completedMissions.add(missionId)
      GM.setValue("completedMissions", JSON.stringify([...completedMissions]))
      
      // Update mission status in tracked missions
      const mission = trackedMissions.find(m => m.id === missionId)
      if (mission) {
        mission.status = "completed"
        mission.completedAt = new Date().toISOString()
        mission.completionReason = reason
        GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
      }
      
      // Remove from rescan queue
      const queueIndex = rescanQueue.findIndex(m => m.id === missionId)
      if (queueIndex !== -1) {
        rescanQueue.splice(queueIndex, 1)
      }
      
      console.log(`Mission ${missionId} marked as completed: ${reason}`)
      showNotification(`✅ Mission abgeschlossen: ${mission ? mission.name : missionId}`, "info")
      
      return true
    }
    return false
  }

  // Clean up old completed missions
  function cleanupOldCompletedMissions() {
    const cutoffTime = Date.now() - (CONFIG.completedMissionRetentionDays * 24 * 60 * 60 * 1000)
    let removedCount = 0
    
    trackedMissions = trackedMissions.filter(mission => {
      if (mission.status === "completed" && mission.completedAt) {
        const completedTime = new Date(mission.completedAt).getTime()
        if (completedTime < cutoffTime) {
          completedMissions.delete(mission.id)
          processedMissionIds.delete(mission.id)
          removedCount++
          return false
        }
      }
      return true
    })
    
    if (removedCount > 0) {
      GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
      GM.setValue("completedMissions", JSON.stringify([...completedMissions]))
      console.log(`Cleaned up ${removedCount} old completed missions`)
    }
  }

  // Add button to navbar
  function addNavbarButton() {
    if (!verifyUserProfile()) return

    const navbar = document.querySelector('.nav.navbar-nav.navbar-right')
    if (navbar && !document.getElementById('player-stats-btn')) {
      const li = document.createElement('li')
      li.innerHTML = `
        <a href="#" id="player-stats-btn" title="LSSTracker - Smart Mission Tracking">
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
      
      document.getElementById('player-stats-btn').addEventListener('click', (e) => {
        e.preventDefault()
        if (verifyUserProfile()) {
          toggleUI()
        }
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

  // Toggle UI visibility
  function toggleUI() {
    const existingPanel = document.getElementById("mission-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
    } else {
      createUI()
    }
  }

  // Get mission statistics
  function getMissionStatistics() {
    const activeMissions = trackedMissions.filter(m => m.status !== "completed").length
    const completedMissionsCount = trackedMissions.filter(m => m.status === "completed").length
    const totalMissions = trackedMissions.length
    
    return {
      active: activeMissions,
      completed: completedMissionsCount,
      total: totalMissions
    }
  }

  // Create UI Panel with completion tracking
  function createUI() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const playerStats = calculatePlayerStats(timeFilter)
    const missionStats = getMissionStatistics()
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
                    <h3 style="margin: 0; color: #007bff;">📊 LSSTracker v2.3 (Smart)</h3>
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
                            <span><strong>Benutzer:</strong></span>
                            <span>${currentUser.userName} (${currentUser.userId})</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Status:</strong></span>
                            <span id="tracking-status">${isTracking ? "🟢 Aktiv" : "🔴 Gestoppt"}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Zeitfilter:</strong></span>
                            <span id="time-filter-display">${timeFilter.label}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Missionen:</strong></span>
                            <span id="mission-count">🟢 ${missionStats.active} aktiv | ✅ ${missionStats.completed} abgeschlossen</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Aktive Spieler:</strong></span>
                            <span id="player-count">${Object.keys(playerStats).length}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Neue Missionen:</strong></span>
                            <span id="processing-count">${processingQueue.length} wartend</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Live-Rescan:</strong></span>
                            <span id="rescan-count">${rescanQueue.length} wartend</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span><strong>Letzte Prüfung:</strong></span>
                            <span id="last-check">${lastCheck ? new Date(lastCheck).toLocaleTimeString() : "Nie"}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span><strong>Letzter Rescan:</strong></span>
                            <span id="last-rescan">${lastRescan ? new Date(lastRescan).toLocaleTimeString() : "Nie"}</span>
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
                            ">Gesamtzeit</button>
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
                        ">📋 Missionen</button>

                        <button id="manual-rescan" style="
                            background: #fd7e14;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-right: 8px;
                        ">🔄 Rescan</button>

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

      if (!inTimeRange && timeFilter.start > 0) return

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

    const now = Date.now()
    const periodStart = timeFilter.start
    const currentEarnings = profileData.totalEarnings || 0

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

  // Get missions that need rescanning (active missions only)
  function getMissionsForRescan() {
    const cutoffTime = Date.now() - (CONFIG.rescanActiveHours * 60 * 60 * 1000)
    return trackedMissions.filter(mission => {
      const missionTime = new Date(mission.timestamp).getTime()
      const isInTimeRange = missionTime >= cutoffTime
      const isNotCompleted = mission.status !== "completed" && !completedMissions.has(mission.id)
      
      return isInTimeRange && isNotCompleted
    })
  }

  // Enhanced rescan with completion detection
  function rescanMission(mission) {
    rescanRequests++
    updateRescanCount()

    GM.xmlhttpRequest({
      method: "GET",
      url: `https://www.leitstellenspiel.de/missions/${mission.id}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      onload: (response) => {
        try {
          // Check if mission is completed first
          if (isMissionCompleted(response.responseText)) {
            markMissionCompleted(mission.id, "detected during rescan")
            rescanRequests--
            updateRescanCount()
            processRescanQueue()
            return
          }

          // Mission is still active, process normally
          const updatedMissionData = parseDetailedMissionData(response.responseText, mission.id, mission)
          if (updatedMissionData) {
            // Compare present players
            const oldPlayers = new Set(mission.presentPlayers || [])
            const newPlayers = new Set(updatedMissionData.presentPlayers || [])
            
            // Check for new players
            const addedPlayers = [...newPlayers].filter(player => !oldPlayers.has(player))
            const removedPlayers = [...oldPlayers].filter(player => !newPlayers.has(player))
            
            if (addedPlayers.length > 0 || removedPlayers.length > 0) {
              // Update the mission data
              const missionIndex = trackedMissions.findIndex(m => m.id === mission.id)
              if (missionIndex !== -1) {
                trackedMissions[missionIndex].presentPlayers = updatedMissionData.presentPlayers
                trackedMissions[missionIndex].lastRescan = Date.now()
                trackedMissions[missionIndex].status = "active" // Ensure it's marked as active
                GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
                
                // Extract and fetch player profiles for new players
                extractAndFetchPlayerProfiles(response.responseText)
                
                updateUI()
                
                if (addedPlayers.length > 0) {
                  showNotification(
                    `🔄 ${mission.name}: ${addedPlayers.length} neue Spieler anwesend (${addedPlayers.join(', ')})`, 
                    "info"
                  )
                }
                
                console.log(`Rescan ${mission.id}: +${addedPlayers.length} -${removedPlayers.length} players`)
              }
            } else {
              // No changes, just update last rescan time
              const missionIndex = trackedMissions.findIndex(m => m.id === mission.id)
              if (missionIndex !== -1) {
                trackedMissions[missionIndex].lastRescan = Date.now()
                GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
              }
            }
          }
        } catch (error) {
          console.error(`Error rescanning mission ${mission.id}:`, error)
          
          // If we get a parsing error, the mission might be completed or inaccessible
          if (error.message && error.message.includes("Cannot read")) {
            markMissionCompleted(mission.id, "parsing error - likely completed")
          }
        }

        rescanRequests--
        updateRescanCount()
        processRescanQueue()
      },
      onerror: (error) => {
        console.error(`Error rescanning mission ${mission.id}:`, error)
        
        // Network error might indicate mission is no longer accessible
        markMissionCompleted(mission.id, "network error - possibly completed")
        
        rescanRequests--
        updateRescanCount()
        processRescanQueue()
      },
    })
  }

  // Process rescan queue (only active missions)
  function processRescanQueue() {
    while (rescanQueue.length > 0 && rescanRequests < CONFIG.maxConcurrentRequests) {
      const mission = rescanQueue.shift()
      
      // Double-check mission is not completed before rescanning
      if (!completedMissions.has(mission.id) && mission.status !== "completed") {
        rescanMission(mission)
      } else {
        // Skip completed missions
        console.log(`Skipping rescan of completed mission: ${mission.id}`)
      }
    }
  }

  // Start live rescanning of existing missions
  function startLiveRescanning() {
    if (!isTracking || !verifyUserProfile()) return

    const missionsToRescan = getMissionsForRescan()
    
    // Add missions to rescan queue (avoid duplicates and completed missions)
    missionsToRescan.forEach(mission => {
      const alreadyQueued = rescanQueue.some(queuedMission => queuedMission.id === mission.id)
      const isCompleted = completedMissions.has(mission.id) || mission.status === "completed"
      
      if (!alreadyQueued && !isCompleted) {
        rescanQueue.push(mission)
      }
    })

    if (rescanQueue.length > 0) {
      console.log(`Starting rescan of ${rescanQueue.length} active missions`)
      processRescanQueue()
    }

    lastRescan = Date.now()
    GM.setValue("lastRescan", lastRescan)
    
    const lastRescanElement = document.getElementById("last-rescan")
    if (lastRescanElement) {
      lastRescanElement.textContent = new Date(lastRescan).toLocaleTimeString()
    }

    // Clean up old completed missions periodically
    if (Math.random() < 0.1) { // 10% chance each cycle
      cleanupOldCompletedMissions()
    }

    // Schedule next rescan
    setTimeout(startLiveRescanning, CONFIG.rescanInterval)
  }

  // Manual rescan trigger
  function triggerManualRescan() {
    if (!verifyUserProfile()) return

    const missionsToRescan = getMissionsForRescan()
    
    if (missionsToRescan.length === 0) {
      showNotification("Keine aktiven Missionen zum Rescannen gefunden", "info")
      return
    }

    // Clear existing rescan queue and add all active missions
    rescanQueue.length = 0
    rescanQueue.push(...missionsToRescan)
    
    showNotification(`Manueller Rescan gestartet: ${missionsToRescan.length} aktive Missionen`, "info")
    processRescanQueue()
  }

  // Fetch player profile data with history tracking
  function fetchPlayerProfile(playerName, playerId) {
    GM.xmlhttpRequest({
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

            const oldEarnings = playerProfiles[playerName].totalEarnings
            playerProfiles[playerName].totalEarnings = totalEarnings
            playerProfiles[playerName].lastUpdated = now

            if (oldEarnings !== totalEarnings) {
              playerProfiles[playerName].history.push({
                timestamp: now,
                totalEarnings: totalEarnings
              })

              if (playerProfiles[playerName].history.length > 100) {
                playerProfiles[playerName].history = playerProfiles[playerName].history.slice(-100)
              }
            }

            GM.setValue("playerProfiles", JSON.stringify(playerProfiles))
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
    document.getElementById("manual-rescan").addEventListener("click", triggerManualRescan)
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
    GM.setValue("currentTimeFilter", filter)
    
    const existingPanel = document.getElementById("mission-tracker-panel")
    if (existingPanel) {
      existingPanel.remove()
      createUI()
    }
  }

  // Toggle minimize
  function toggleMinimize() {
    isMinimized = !isMinimized
    GM.setValue("isMinimized", isMinimized)

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
    if (!verifyUserProfile()) return

    isTracking = !isTracking
    GM.setValue("isTracking", isTracking)

    const button = document.getElementById("toggle-tracking")
    const status = document.getElementById("tracking-status")

    if (isTracking) {
      button.textContent = "⏹️ Stop Tracking"
      button.style.background = "#dc3545"
      status.textContent = "🟢 Aktiv"
      startTracking()
      startLiveRescanning() // Start live rescanning
      showNotification("LSSTracker mit Smart Completion Detection gestartet!", "success")
    } else {
      button.textContent = "▶️ Start Tracking"
      button.style.background = "#28a745"
      status.textContent = "🔴 Gestoppt"
      showNotification("LSSTracker gestoppt!", "info")
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
        showNotification(`${newMissionsFound} neue Mission(en) gefunden! Verarbeitung...`, "info")
        processQueue()
      }

      lastCheck = Date.now()
      GM.setValue("lastCheck", lastCheck)
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

    GM.xmlhttpRequest({
      method: "GET",
      url: `https://www.leitstellenspiel.de/missions/${missionId}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      onload: (response) => {
        try {
          // Check if mission is completed
          if (isMissionCompleted(response.responseText)) {
            markMissionCompleted(missionId, "completed at first scan")
            activeRequests--
            updateProcessingCount()
            processQueue()
            return
          }

          extractAndFetchPlayerProfiles(response.responseText)
          
          const missionData = parseDetailedMissionData(response.responseText, missionId, basicData)
          if (missionData && missionData.sharedBy !== "Unknown Member") {
            missionData.status = "active" // Mark as active
            trackedMissions.unshift(missionData)

            if (trackedMissions.length > CONFIG.maxMissions) {
              trackedMissions = trackedMissions.slice(0, CONFIG.maxMissions)
            }

            GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
            updateUI()
            
            const presentCount = missionData.presentPlayers ? missionData.presentPlayers.length : 0
            showNotification(
              `✅ ${missionData.sharedBy}: ${missionData.credits.toLocaleString()} Credits | ${presentCount} Spieler anwesend`, 
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
        lastRescan: Date.now(),
        status: "active" // Default status
      }
    } catch (error) {
      console.error("Error parsing detailed mission data:", error)
      return null
    }
  }

  // Fetch credits from help page
  function fetchCreditsFromHelpPage(helpUrl, missionId) {
    GM.xmlhttpRequest({
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
            GM.setValue("trackedMissions", JSON.stringify(trackedMissions))
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
      showNotification("Keine Spielerstatistiken zum Exportieren!", "warning")
      return
    }

    try {
      const headers = [
        "Spielername",
        "Missionen geteilt",
        "Missionen anwesend", 
        "Geteilte Credits",
        "Anwesenheits-Credits",
        "Wachstum % von Anwesenheit",
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
      const filename = `lsstracker_smart_stats_${currentTimeFilter}_${new Date().toISOString().split("T")[0]}.csv`

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
      console.error("CSV Export Error:", error)
      showNotification("❌ CSV Export fehlgeschlagen! Siehe Konsole für Details.", "error")
    }
  }

  // View Player Statistics
  function viewPlayerStats() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const playerStats = calculatePlayerStats(timeFilter)
    const missionStats = getMissionStatistics()
    const players = Object.entries(playerStats).sort(([, a], [, b]) => 
      b.totalCredits - a.totalCredits
    )

    const popup = window.open("", "playerstats", "width=1200,height=800,scrollbars=yes")
    popup.document.write(`
            <html>
                <head>
                    <title>LSSTracker Smart - Spielerstatistiken - ${players.length} Spieler (${timeFilter.label})</title>
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
                        <h2>🏆 LSSTracker Smart - Spielerstatistiken (${timeFilter.label})</h2>
                        <p><strong>Benutzer:</strong> ${currentUser.userName} (ID: ${currentUser.userId})</p>
                        <p><strong>Spieler gesamt:</strong> ${players.length}</p>
                        <p><strong>Missionen:</strong> 🟢 ${missionStats.active} aktiv | ✅ ${missionStats.completed} abgeschlossen | 📊 ${missionStats.total} gesamt</p>
                        <p><strong>Zeitraum:</strong> ${timeFilter.label}</p>
                        <p><strong>Smart Completion:</strong> Abgeschlossene Missionen werden automatisch erkannt und aus dem Rescan entfernt</p>
                    </div>

                    <table id="playerTable">
                        <thead>
                            <tr>
                                <th>Rang</th>
                                <th>Spielername</th>
                                <th>Missionen geteilt</th>
                                <th>Missionen anwesend</th>
                                <th>Geteilte Credits</th>
                                <th>Anwesenheits-Credits</th>
                                <th>Wachstum % von Anwesenheit</th>
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
                        <small><strong>Smart Completion Detection:</strong> Das System erkennt automatisch abgeschlossene Missionen und entfernt sie aus dem Rescan-Prozess, während alle gesammelten Daten erhalten bleiben.</small>
                    </div>
                </body>
            </html>
        `)
  }

  // View all missions with completion status
  function viewAllMissions() {
    const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
    const filteredMissions = trackedMissions.filter(mission => {
      const missionTime = new Date(mission.timestamp).getTime()
      return timeFilter.start === 0 || (missionTime >= timeFilter.start && missionTime <= timeFilter.end)
    })

    const popup = window.open("", "missions", "width=1400,height=800,scrollbars=yes")
    const totalCredits = filteredMissions.reduce((sum, m) => sum + (m.credits || 0), 0)
    const activeMissions = filteredMissions.filter(m => m.status !== "completed").length
    const completedMissions = filteredMissions.filter(m => m.status === "completed").length

    popup.document.write(`
            <html>
                <head>
                    <title>LSSTracker Smart - Verfolgte Missionen - ${filteredMissions.length} Total (${timeFilter.label})</title>
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
                        .rescan-info { font-size: 0.8em; color: #ffc107; }
                        .status-active { color: #28a745; font-weight: bold; }
                        .status-completed { color: #6c757d; font-weight: bold; }
                        .completed-row { opacity: 0.7; }
                    </style>
                </head>
                <body>
                    <div class="stats">
                        <h2>📋 LSSTracker Smart - Verfolgte Missionen (${timeFilter.label})</h2>
                        <p><strong>Benutzer:</strong> ${currentUser.userName} (ID: ${currentUser.userId})</p>
                        <p><strong>Gefilterte Missionen:</strong> ${filteredMissions.length} (🟢 ${activeMissions} aktiv | ✅ ${completedMissions} abgeschlossen)</p>
                        <p><strong>Credits gesamt:</strong> ${totalCredits.toLocaleString()}</p>
                        <p><strong>Smart Completion:</strong> Abgeschlossene Missionen werden automatisch erkannt</p>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Zeit</th>
                                <th>Mission</th>
                                <th>Geteilt von</th>
                                <th>Credits</th>
                                <th>Anwesende Spieler</th>
                                <th>Letzter Rescan</th>
                                <th>Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredMissions
                              .map(
                                (mission) => {
                                  const isCompleted = mission.status === "completed"
                                  const statusClass = isCompleted ? "status-completed" : "status-active"
                                  const rowClass = isCompleted ? "completed-row" : ""
                                  const statusText = isCompleted ? "✅ Abgeschlossen" : "🟢 Aktiv"
                                  
                                  return `
                                <tr class="${rowClass}">
                                    <td class="${statusClass}">${statusText}</td>
                                    <td class="timestamp">${new Date(mission.timestamp).toLocaleString()}</td>
                                    <td><strong>${mission.name}</strong></td>
                                    <td class="shared-by">${mission.sharedBy}</td>
                                    <td class="credits">${(mission.credits || 0).toLocaleString()}</td>
                                    <td class="present-players">
                                        ${mission.presentPlayers && mission.presentPlayers.length > 0 ? 
                                          `${mission.presentPlayers.length} Spieler: ${mission.presentPlayers.slice(0, 3).join(', ')}${mission.presentPlayers.length > 3 ? '...' : ''}` : 
                                          'Keine Spieler anwesend'
                                        }
                                    </td>
                                    <td class="rescan-info">
                                        ${isCompleted ? 
                                          (mission.completedAt ? new Date(mission.completedAt).toLocaleTimeString() : 'Abgeschlossen') :
                                          (mission.lastRescan ? new Date(mission.lastRescan).toLocaleTimeString() : 'Nie')
                                        }
                                    </td>
                                    <td><a href="${mission.url}" target="_blank">Öffnen</a></td>
                                </tr>
                            `}
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
      element.textContent = `${processingQueue.length} wartend`
    }
  }

  // Update rescan count display
  function updateRescanCount() {
    const element = document.getElementById("rescan-count")
    if (element) {
      element.textContent = `${rescanQueue.length} wartend`
    }
  }

  // Clear all data
  function clearData() {
    if (confirm("Sind Sie sicher, dass Sie alle verfolgten Daten löschen möchten?")) {
      trackedMissions = []
      processedMissionIds.clear()
      playerProfiles = {}
      completedMissions.clear()
      GM.setValue("trackedMissions", "[]")
      GM.setValue("playerProfiles", "{}")
      GM.setValue("completedMissions", "[]")
      updateUI()
      showNotification("Alle Daten gelöscht!", "info")
    }
  }

  // Update UI
  function updateUI() {
    const panel = document.getElementById("mission-tracker-panel")
    if (panel) {
      const timeFilter = getTimeFilterBoundaries(currentTimeFilter)
      const playerStats = calculatePlayerStats(timeFilter)
      const missionStats = getMissionStatistics()
      
      const missionCountEl = document.getElementById("mission-count")
      const playerCountEl = document.getElementById("player-count")
      const timeFilterEl = document.getElementById("time-filter-display")
      
      if (missionCountEl) missionCountEl.innerHTML = `🟢 ${missionStats.active} aktiv | ✅ ${missionStats.completed} abgeschlossen`
      if (playerCountEl) playerCountEl.textContent = Object.keys(playerStats).length
      if (timeFilterEl) timeFilterEl.textContent = timeFilter.label
      
      updateProcessingCount()
      updateRescanCount()
      
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

    GM.notification({
      text: message,
      title: "LSSTracker Smart",
      timeout: 4000,
    })

    console.log(`[LSSTracker Smart] ${message}`)
  }

  // Initialize when page loads
  function init() {
    if (!verifyUserProfile()) return

    if (window.location.pathname === "/" || window.location.pathname === "") {
      addNavbarButton()

      if (isTracking) {
        startTracking()
        startLiveRescanning() // Start live rescanning
      }

      showNotification(`LSSTracker Smart v2.3 bereit für ${currentUser.userName}!`, "info")
    }
  }

  // Periodic security check
  setInterval(() => {
    if (!verifyUserProfile()) {
      isTracking = false
      GM.setValue("isTracking", false)
      const panel = document.getElementById("mission-tracker-panel")
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
    init()
  }
})()
