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
    rescanInterval: 1200000, // Rescan existing missions every 20 minutes
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

  // Initialize when page loads
  function init() {
    if (!verifyUserProfile()) return

    if (window.location.pathname === "/" || window.location.pathname === "") {
      addNavbarButton()

      if (isTracking) {
        startTracking()
        startLiveRescanning()
      }

      showNotification(`LSSTracker Smart v2.3 bereit für ${currentUser.userName}!`, "info")
    }
  }

  // Wait for page to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  // [Rest of the main script functions would continue here...]

  function toggleUI() {
    console.log("toggleUI called")
  }

  function startTracking() {
    console.log("startTracking called")
  }

  function startLiveRescanning() {
    console.log("startLiveRescanning called")
  }

  function showNotification(message, type) {
    console.log(`Notification: ${message} (${type})`)
  }
})()
