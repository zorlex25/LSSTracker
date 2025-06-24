// ==UserScript==
// @name         LSSTracker Loader (Debug)
// @version      1.0
// @description  LSSTracker loader with profile verification and user authentication (Debug Mode)
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
  // 🔐 Configuration - DEBUG MODE ENABLED
  const CONFIG = {
    MAIN_CODE_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/LSSTracker.js",
    USER_LIST_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/allowed_users.json",
    ENCRYPTION_KEY: "FreiwilligeFeuerwehrLemgo",
    DOMAIN_CHECK: "www.leitstellenspiel.de",
    VERSION: "1.0",
    CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
    TIMEOUT: 8000,
    DEBUG: true, // DEBUG MODE ENABLED
  }

  console.log("🚀 LSSTracker Loader starting...")

  // 🔒 Basic security check
  if (window.location.hostname !== CONFIG.DOMAIN_CHECK) {
    console.log("❌ Wrong domain:", window.location.hostname)
    return
  }

  console.log("✅ Domain check passed")

  // 📡 HTTP request function
  function fetchRemote(url) {
    console.log("📡 Fetching:", url)
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        timeout: CONFIG.TIMEOUT,
        headers: {
          "Cache-Control": "no-cache",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        onload: (response) => {
          console.log("📡 Response status:", response.status, "for", url)
          if (response.status === 200) {
            resolve(response.responseText)
          } else {
            reject(new Error(`HTTP ${response.status}: ${response.statusText}`))
          }
        },
        onerror: (error) => {
          console.error("📡 Network error:", error)
          reject(new Error("Network error: " + error))
        },
        ontimeout: () => {
          console.error("📡 Timeout for:", url)
          reject(new Error("Request timeout"))
        },
      })
    })
  }

  // 💾 Simple cache
  const Cache = {
    set: (key, data) => {
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        version: CONFIG.VERSION,
      }
      GM_setValue(`lss_${key}`, JSON.stringify(cacheData))
      console.log("💾 Cached:", key)
    },

    get: (key) => {
      try {
        const cached = GM_getValue(`lss_${key}`, null)
        if (!cached) {
          console.log("💾 Cache miss:", key)
          return null
        }

        const cacheData = JSON.parse(cached)

        if (cacheData.version !== CONFIG.VERSION || Date.now() - cacheData.timestamp > CONFIG.CACHE_DURATION) {
          GM_deleteValue(`lss_${key}`)
          console.log("💾 Cache expired:", key)
          return null
        }

        console.log("💾 Cache hit:", key)
        return cacheData.data
      } catch (e) {
        console.error("💾 Cache error:", e)
        GM_deleteValue(`lss_${key}`)
        return null
      }
    },
  }

  // 👤 Get current user ID and profile data
  function getCurrentUserData() {
    console.log("👤 Getting user data...")
    let userId = null
    let userName = null

    // Method 1: Profile link in navbar
    const profileLink = document.querySelector('a[href^="/profile/"]')
    if (profileLink) {
      console.log("👤 Found profile link:", profileLink.href)
      const match = profileLink.href.match(/\/profile\/(\d+)/)
      if (match) {
        userId = Number.parseInt(match[1])
        userName = profileLink.textContent.trim()
        console.log("👤 Method 1 - User ID:", userId, "Name:", userName)
      }
    }

    // Method 2: Navbar profile link
    if (!userId) {
      const navbarProfile = document.querySelector('#navbar_profile_link')
      if (navbarProfile) {
        console.log("👤 Found navbar profile link:", navbarProfile.href)
        const match = navbarProfile.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = navbarProfile.textContent.trim()
          console.log("👤 Method 2 - User ID:", userId, "Name:", userName)
        }
      }
    }

    // Method 3: Any profile link
    if (!userId) {
      const allProfileLinks = document.querySelectorAll('a[href*="/profile/"]')
      console.log("👤 Found profile links:", allProfileLinks.length)
      for (const link of allProfileLinks) {
        const match = link.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = link.textContent.trim()
          console.log("👤 Method 3 - User ID:", userId, "Name:", userName, "Link:", link.href)
          break
        }
      }
    }

    // Method 4: Page source analysis
    if (!userId) {
      console.log("👤 Trying page source analysis...")
      const scripts = document.querySelectorAll("script")
      for (const script of scripts) {
        if (script.textContent && script.textContent.includes("user_id")) {
          const match = script.textContent.match(/user_id["\s]*[:=]["\s]*(\d+)/)
          if (match) {
            userId = Number.parseInt(match[1])
            console.log("👤 Method 4 - User ID from script:", userId)
            break
          }
        }
      }
    }

    console.log("👤 Final result - User ID:", userId, "Name:", userName)
    return { userId, userName }
  }

  // 🏠 Check if main page
  function isMainPage() {
    const isMain = window.location.pathname === "/" || window.location.pathname === "/missions" || window.location.pathname === ""
    console.log("🏠 Is main page:", isMain, "Path:", window.location.pathname)
    return isMain
  }

  // 🚪 Force logout unauthorized user
  function forceLogout() {
    console.log("🚪 Forcing logout...")
    GM_notification({
      text: "Du bist nicht berechtigt, dieses Script zu nutzen! Script wird deaktiviert.",
      title: "LSSTracker - Zugriff verweigert",
      timeout: 5000,
    })

    alert("Du bist nicht berechtigt, dieses Script zu nutzen!")
  }

  // 🔍 Verify user access with profile data
  async function verifyUserAccess() {
    try {
      console.log("🔍 Starting user verification...")
      const userData = getCurrentUserData()
      if (!userData.userId) {
        throw new Error("Could not determine user ID")
      }

      console.log("🔍 User data:", userData)

      // Check cache first
      const cachedResult = Cache.get("user_check")
      if (cachedResult && cachedResult.userId === userData.userId) {
        console.log("🔍 Using cached verification result")
        return {
          allowed: cachedResult.allowed,
          allowedUsers: cachedResult.allowedUsers,
          userData: userData,
        }
      }

      // Load encrypted user list from GitHub
      console.log("🔍 Loading user list from GitHub...")
      const res = await fetchRemote(CONFIG.USER_LIST_URL)
      console.log("🔍 User list response length:", res.length)
      
      const json = JSON.parse(res)
      console.log("🔍 Parsed JSON keys:", Object.keys(json))
      
      const encryptedText = json.encryptedUserIDs
      console.log("🔍 Encrypted text length:", encryptedText ? encryptedText.length : "null")

      if (!encryptedText) {
        throw new Error("Invalid user list format")
      }

      // Decrypt using CryptoJS
      console.log("🔍 Decrypting user list...")
      const bytes = CryptoJS.AES.decrypt(encryptedText, CONFIG.ENCRYPTION_KEY)
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8)
      console.log("🔍 Decrypted string length:", decryptedStr.length)

      if (!decryptedStr) throw new Error("Decryption failed")

      const allowedUsers = JSON.parse(decryptedStr)
      console.log("🔍 Allowed users:", allowedUsers)

      if (!Array.isArray(allowedUsers)) {
        throw new Error("Invalid user data")
      }

      const isAllowed = allowedUsers.includes(userData.userId)
      console.log("🔍 User", userData.userId, "allowed:", isAllowed)

      // Cache the result
      Cache.set("user_check", {
        userId: userData.userId,
        allowed: isAllowed,
        allowedUsers: allowedUsers,
      })

      // 🚨 FORCE LOGOUT IF NOT AUTHORIZED
      if (!isAllowed) {
        console.log(`❌ User ${userData.userId} (${userData.userName}) not authorized`)
        forceLogout()
        return { allowed: false, allowedUsers: null, userData: null }
      }

      console.log(`✅ User ${userData.userId} (${userData.userName}) authorized`)
      return { allowed: true, allowedUsers: allowedUsers, userData: userData }
    } catch (error) {
      console.error("❌ User verification failed:", error)
      forceLogout()
      return { allowed: false, allowedUsers: null, userData: null }
    }
  }

  // 📥 Load main code
  async function loadMainCode() {
    try {
      console.log("📥 Loading main code...")
      let mainCode = Cache.get("main_code")

      if (!mainCode) {
        console.log("📥 Fetching main code from GitHub...")
        mainCode = await fetchRemote(CONFIG.MAIN_CODE_URL)
        console.log("📥 Main code length:", mainCode.length)

        if (!mainCode.includes("function") && !mainCode.includes("=>")) {
          throw new Error("Invalid code received")
        }

        Cache.set("main_code", mainCode)
      } else {
        console.log("📥 Using cached main code")
      }

      return mainCode
    } catch (error) {
      console.error("📥 Failed to load main code:", error)
      throw error
    }
  }

  // 🚀 Execute the main code
  function executeMainCode(code, allowedUsers, userData) {
    try {
      console.log("🚀 Executing main code...")
      
      // Set global variables that the main script expects
      window.lssTrackerAllowedUsers = allowedUsers
      window.lssTrackerUserData = userData
      console.log("🚀 Set global variables:", { allowedUsers: allowedUsers.length, userData })

      // Remove userscript headers if present
      const cleanCode = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, "")
      console.log("🚀 Cleaned code length:", cleanCode.length)

      // Create execution function with necessary globals
      const executor = new Function(
        "window",
        "document",
        "$",
        "jQuery",
        "GM_xmlhttpRequest",
        "GM_addStyle",
        "GM_setValue",
        "GM_getValue",
        "GM_deleteValue",
        "GM_notification",
        "console",
        cleanCode,
      )

      // Execute with full environment
      executor(
        window,
        document,
        $,
        jQuery,
        GM_xmlhttpRequest,
        GM_addStyle,
        GM_setValue,
        GM_getValue,
        GM_deleteValue,
        GM_notification,
        console,
      )

      console.log("🚀 Main code executed successfully")

      // Show success notification
      GM_notification({
        text: `LSSTracker erfolgreich geladen für ${userData.userName}`,
        title: "LSSTracker",
        timeout: 3000,
      })
    } catch (error) {
      console.error("❌ Code execution failed:", error)
      GM_notification({
        text: "Fehler beim Laden des LSSTracker Scripts: " + error.message,
        title: "LSSTracker - Fehler",
        timeout: 5000,
      })
      throw error
    }
  }

  // 🎯 Main initialization
  async function initialize() {
    try {
      console.log("🎯 Starting initialization...")
      
      // Only run on main pages
      if (!isMainPage()) {
        console.log("🎯 Not on main page, exiting")
        return
      }

      // Show loading notification
      GM_notification({
        text: "LSSTracker wird geladen...",
        title: "LSSTracker",
        timeout: 2000,
      })

      // Verify user access with profile data
      console.log("🎯 Verifying user access...")
      const accessResult = await verifyUserAccess()
      if (!accessResult.allowed) {
        console.log("🎯 User not allowed, exiting")
        return
      }

      // Load and execute main code
      console.log("🎯 Loading main code...")
      const mainCode = await loadMainCode()
      
      console.log("🎯 Executing main code...")
      executeMainCode(mainCode, accessResult.allowedUsers, accessResult.userData)

      console.log("✅ LSSTracker loaded successfully")
    } catch (error) {
      console.error("❌ LSSTracker loader failed:", error)
      GM_notification({
        text: "LSSTracker konnte nicht geladen werden: " + error.message,
        title: "LSSTracker - Fehler",
        timeout: 5000,
      })
    }
  }

  // 🔄 Wait for page readiness
  function startLoader() {
    console.log("🔄 Starting loader, readyState:", document.readyState)
    if (document.readyState === "loading") {
      console.log("🔄 Waiting for DOMContentLoaded...")
      document.addEventListener("DOMContentLoaded", initialize)
    } else {
      console.log("🔄 DOM already ready, starting with delay...")
      setTimeout(initialize, 1500)
    }
  }

  // 🎬 Start the loader
  startLoader()
})()
