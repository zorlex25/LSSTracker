// ==UserScript==
// @name         LSSTracker Diagnostic Loader
// @version      1.3
// @description  Diagnostic version to debug the main LSSTracker code
// @author       zorlex25
// @match        *://www.leitstellenspiel.de/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @updateURL    https://raw.githubusercontent.com/zorlex25/LSSTracker/main/loader.user.js
// @downloadURL  https://raw.githubusercontent.com/zorlex25/LSSTracker/main/loader.user.js
// ==/UserScript==

;(async () => {
  // 🔐 Configuration
  const CONFIG = {
    MAIN_CODE_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/LSSTracker.js",
    USER_LIST_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/allowed_users.json",
    ENCRYPTION_KEY: "FreiwilligeFeuerwehrLemgo",
    DOMAIN_CHECK: "www.leitstellenspiel.de",
    VERSION: "1.3",
    CACHE_DURATION: 10 * 60 * 1000,
    TIMEOUT: 8000,
    DEBUG: true,
  }

  if (window.location.hostname !== CONFIG.DOMAIN_CHECK) {
    return
  }

  // 📡 HTTP request function
  function fetchRemote(url) {
    return new Promise((resolve, reject) => {
      window.GM_xmlhttpRequest({
        method: "GET",
        url: url,
        timeout: CONFIG.TIMEOUT,
        headers: {
          "Cache-Control": "no-cache",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        onload: (response) => {
          if (response.status === 200) {
            resolve(response.responseText)
          } else {
            reject(new Error(`HTTP ${response.status}: ${response.statusText}`))
          }
        },
        onerror: (error) => reject(new Error("Network error: " + error)),
        ontimeout: () => reject(new Error("Request timeout")),
      })
    })
  }

  // 💾 Cache (simplified for diagnostic)
  const Cache = {
    set: (key, data) => {
      window.GM_setValue(`lss_${key}`, JSON.stringify({
        data: data,
        timestamp: Date.now(),
        version: CONFIG.VERSION,
      }))
    },
    get: (key) => {
      try {
        const cached = window.GM_getValue(`lss_${key}`, null)
        if (!cached) return null
        const cacheData = JSON.parse(cached)
        if (cacheData.version !== CONFIG.VERSION || Date.now() - cacheData.timestamp > CONFIG.CACHE_DURATION) {
          window.GM_deleteValue(`lss_${key}`)
          return null
        }
        return cacheData.data
      } catch (e) {
        window.GM_deleteValue(`lss_${key}`)
        return null
      }
    },
  }

  // 👤 Get current user data
  async function getCurrentUserData() {
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

    return { userId, userName }
  }

  // 🏠 Check if main page
  function isMainPage() {
    const path = window.location.pathname
    return path === "/" || path === "/missions" || path === ""
  }

  // 🔍 Verify user access (simplified)
  async function verifyUserAccess() {
    try {
      const userData = await getCurrentUserData()
      if (!userData.userId) {
        throw new Error("Could not determine user ID")
      }

      console.log("🔍 User data found:", userData)

      // For diagnostic purposes, let's assume the user is authorized
      // In production, you'd want to keep the full verification
      return { 
        allowed: true, 
        allowedUsers: [userData.userId], // Simplified
        userData: userData 
      }
    } catch (error) {
      console.error("❌ User verification failed:", error)
      return { allowed: false, allowedUsers: null, userData: null }
    }
  }

  // 📥 Load main code with detailed logging
  async function loadMainCode() {
    try {
      console.log("📥 Loading main code from:", CONFIG.MAIN_CODE_URL)
      
      // Always fetch fresh for diagnostic
      const mainCode = await fetchRemote(CONFIG.MAIN_CODE_URL)
      
      console.log("📄 Main code loaded, length:", mainCode.length)
      console.log("📄 First 500 characters:", mainCode.substring(0, 500))
      console.log("📄 Last 500 characters:", mainCode.substring(mainCode.length - 500))
      
      // Check what the code contains
      const hasJQuery = mainCode.includes('$') || mainCode.includes('jQuery')
      const hasDOM = mainCode.includes('document.') || mainCode.includes('getElementById') || mainCode.includes('querySelector')
      const hasButton = mainCode.includes('button') || mainCode.includes('Button')
      const hasNavbar = mainCode.includes('navbar') || mainCode.includes('nav')
      const hasAppend = mainCode.includes('append') || mainCode.includes('innerHTML') || mainCode.includes('insertAdjacentHTML')
      
      console.log("🔍 Code analysis:")
      console.log("  - Contains jQuery:", hasJQuery)
      console.log("  - Contains DOM manipulation:", hasDOM)
      console.log("  - Contains button creation:", hasButton)
      console.log("  - Contains navbar references:", hasNavbar)
      console.log("  - Contains element insertion:", hasAppend)

      return mainCode
    } catch (error) {
      console.error("❌ Failed to load main code:", error)
      throw error
    }
  }

  // 🚀 Execute main code with extensive debugging
  async function executeMainCode(code, allowedUsers, userData) {
    try {
      console.log("🚀 Starting main code execution...")
      console.log("👤 User data:", userData)
      console.log("✅ Allowed users:", allowedUsers)

      // Set up global variables
      window.lssTrackerAllowedUsers = allowedUsers
      window.lssTrackerUserData = userData

      // Enhanced GM wrapper with logging
      window.lssTrackerGM = {
        setValue: (key, value) => {
          console.log("💾 GM_setValue called:", key, value)
          return window.GM_setValue(key, value)
        },
        getValue: (key, defaultValue) => {
          const result = window.GM_getValue(key, defaultValue)
          console.log("📖 GM_getValue called:", key, "->", result)
          return result
        },
        deleteValue: (key) => {
          console.log("🗑️ GM_deleteValue called:", key)
          return window.GM_deleteValue(key)
        },
        xmlhttpRequest: (details) => {
          console.log("🌐 GM_xmlhttpRequest called:", details.url)
          return window.GM_xmlhttpRequest(details)
        },
        notification: (details) => {
          console.log("🔔 GM_notification called:", details)
          return window.GM_notification(details)
        },
        addStyle: (css) => {
          console.log("🎨 GM_addStyle called, CSS length:", css.length)
          return window.GM_addStyle(css)
        }
      }

      // Override console methods to capture main script logs
      const originalLog = console.log
      const originalError = console.error
      const originalWarn = console.warn

      console.log = (...args) => {
        originalLog("📜 [MAIN SCRIPT]", ...args)
      }
      console.error = (...args) => {
        originalError("❌ [MAIN SCRIPT ERROR]", ...args)
      }
      console.warn = (...args) => {
        originalWarn("⚠️ [MAIN SCRIPT WARN]", ...args)
      }

      // Clean and wrap the code
      const cleanCode = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, "")
      const wrappedCode = cleanCode
        .replace(/GM_setValue/g, 'window.lssTrackerGM.setValue')
        .replace(/GM_getValue/g, 'window.lssTrackerGM.getValue')
        .replace(/GM_deleteValue/g, 'window.lssTrackerGM.deleteValue')
        .replace(/GM_xmlhttpRequest/g, 'window.lssTrackerGM.xmlhttpRequest')
        .replace(/GM_notification/g, 'window.lssTrackerGM.notification')
        .replace(/GM_addStyle/g, 'window.lssTrackerGM.addStyle')

      console.log("🔧 Code wrapped, executing...")

      // Execute with detailed error catching
      try {
        eval(wrappedCode)
        console.log("✅ Main code executed without throwing errors")
      } catch (execError) {
        console.error("💥 Execution error:", execError)
        console.error("📍 Error stack:", execError.stack)
        throw execError
      }

      // Restore console methods
      console.log = originalLog
      console.error = originalError
      console.warn = originalWarn

      // Check DOM changes after execution
      setTimeout(() => {
        console.log("🔍 Post-execution DOM analysis:")
        
        // Check for any new elements
        const allElements = document.querySelectorAll('*')
        const newElements = Array.from(allElements).filter(el => {
          return el.id.includes('lss') || 
                 el.className.includes('lss') || 
                 el.id.includes('tracker') || 
                 el.className.includes('tracker') ||
                 el.textContent.includes('LSSTracker') ||
                 el.textContent.includes('Tracker')
        })
        
        console.log("🎯 Found potential LSSTracker elements:", newElements.length)
        newElements.forEach((el, index) => {
          console.log(`  ${index + 1}. Tag: ${el.tagName}, ID: ${el.id}, Class: ${el.className}, Text: ${el.textContent.substring(0, 50)}`)
        })

        // Check navbar specifically
        const navbar = document.querySelector('nav, .navbar, #navbar')
        if (navbar) {
          console.log("🧭 Navbar found:", navbar)
          console.log("🧭 Navbar children:", navbar.children.length)
          console.log("🧭 Navbar HTML:", navbar.innerHTML.substring(0, 200))
        } else {
          console.log("❌ No navbar found")
        }

        // Check for buttons
        const buttons = document.querySelectorAll('button, .btn, input[type="button"]')
        console.log("🔘 Total buttons on page:", buttons.length)
        
        // Check for any elements added in the last few seconds
        const recentElements = Array.from(allElements).filter(el => {
          return el.dataset && el.dataset.timestamp && 
                 Date.now() - parseInt(el.dataset.timestamp) < 10000
        })
        console.log("🆕 Recently added elements:", recentElements.length)

      }, 2000)

      window.GM_notification({
        text: `LSSTracker Diagnostic: Code executed for ${userData.userName}`,
        title: "LSSTracker Diagnostic",
        timeout: 3000,
      })

    } catch (error) {
      console.error("💥 Main code execution failed:", error)
      console.error("📍 Full error details:", error.stack)
      
      window.GM_notification({
        text: "Diagnostic: Execution failed - " + error.message,
        title: "LSSTracker Diagnostic Error",
        timeout: 5000,
      })
      throw error
    }
  }

  // 🎯 Main initialization
  async function initialize() {
    try {
      if (!isMainPage()) {
        console.log("ℹ️ Not on main page, skipping")
        return
      }

      console.log("🎯 Starting LSSTracker diagnostic initialization...")

      const accessResult = await verifyUserAccess()
      if (!accessResult.allowed) {
        console.log("❌ User not allowed")
        return
      }

      const mainCode = await loadMainCode()
      await executeMainCode(mainCode, accessResult.allowedUsers, accessResult.userData)

      console.log("✅ Diagnostic initialization complete")
    } catch (error) {
      console.error("💥 Diagnostic initialization failed:", error)
      window.GM_notification({
        text: "Diagnostic failed: " + error.message,
        title: "LSSTracker Diagnostic Error",
        timeout: 5000,
      })
    }
  }

  // 🔄 Start the diagnostic loader
  function startLoader() {
    console.log("🔄 Starting diagnostic loader...")
    console.log("📄 Document ready state:", document.readyState)
    console.log("🌐 Current URL:", window.location.href)

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 1000))
    } else {
      setTimeout(initialize, 2000)
    }
  }

  startLoader()
})()
