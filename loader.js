// ==UserScript==
// @name         LSSTracker Loader (Fixed)
// @version      1.1
// @description  LSSTracker loader with profile verification and user authentication (Fixed)
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
    VERSION: "1.1",
    CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
    TIMEOUT: 8000,
    DEBUG: false, // Set to true for debugging
  }

  // 🔒 Basic security check
  if (window.location.hostname !== CONFIG.DOMAIN_CHECK) {
    return
  }

  // 📡 HTTP request function
  function fetchRemote(url) {
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

  // 💾 Simple cache
  const Cache = {
    set: (key, data) => {
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        version: CONFIG.VERSION,
      }
      GM_setValue(`lss_${key}`, JSON.stringify(cacheData))
    },

    get: (key) => {
      try {
        const cached = GM_getValue(`lss_${key}`, null)
        if (!cached) return null

        const cacheData = JSON.parse(cached)

        if (cacheData.version !== CONFIG.VERSION || Date.now() - cacheData.timestamp > CONFIG.CACHE_DURATION) {
          GM_deleteValue(`lss_${key}`)
          return null
        }

        return cacheData.data
      } catch (e) {
        GM_deleteValue(`lss_${key}`)
        return null
      }
    },
  }

  // 👤 Get current user ID and profile data
  function getCurrentUserData() {
    let userId = null
    let userName = null

    // Method 1: Profile link in navbar
    const profileLink = document.querySelector('a[href^="/profile/"]')
    if (profileLink) {
      const match = profileLink.href.match(/\/profile\/(\d+)/)
      if (match) {
        userId = Number.parseInt(match[1])
        userName = profileLink.textContent.trim()
      }
    }

    // Method 2: Navbar profile link
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

    // Method 3: Any profile link
    if (!userId) {
      const allProfileLinks = document.querySelectorAll('a[href*="/profile/"]')
      for (const link of allProfileLinks) {
        const match = link.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = link.textContent.trim()
          break
        }
      }
    }

    return { userId, userName }
  }

  // 🏠 Check if main page
  function isMainPage() {
    return window.location.pathname === "/" || window.location.pathname === "/missions" || window.location.pathname === ""
  }

  // 🚪 Force logout unauthorized user
  function forceLogout() {
    GM_notification({
      text: "Du bist nicht berechtigt, dieses Script zu nutzen! Script wird deaktiviert.",
      title: "LSSTracker - Zugriff verweigert",
      timeout: 5000,
    })

    alert("Du bist nicht berechtigt, dieses Script zu nutzen!")
    
    // Try multiple logout methods
    const logoutBtn = document.getElementById("logout_button")
    if (logoutBtn) {
      logoutBtn.click()
    } else {
      const logoutLink = document.querySelector('a[href*="sign_out"]')
      if (logoutLink) {
        logoutLink.click()
      } else {
        window.location.href = "/users/sign_out"
      }
    }
  }

  // 🔍 Verify user access with profile data
  async function verifyUserAccess() {
    try {
      const userData = getCurrentUserData()
      if (!userData.userId) {
        throw new Error("Could not determine user ID")
      }

      // Check cache first
      const cachedResult = Cache.get("user_check")
      if (cachedResult && cachedResult.userId === userData.userId) {
        return {
          allowed: cachedResult.allowed,
          allowedUsers: cachedResult.allowedUsers,
          userData: userData,
        }
      }

      // Load encrypted user list from GitHub
      const res = await fetchRemote(CONFIG.USER_LIST_URL)
      const json = JSON.parse(res)
      const encryptedText = json.encryptedUserIDs

      if (!encryptedText) {
        throw new Error("Invalid user list format")
      }

      // Decrypt using CryptoJS
      const bytes = CryptoJS.AES.decrypt(encryptedText, CONFIG.ENCRYPTION_KEY)
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8)

      if (!decryptedStr) throw new Error("Decryption failed")

      const allowedUsers = JSON.parse(decryptedStr)

      if (!Array.isArray(allowedUsers)) {
        throw new Error("Invalid user data")
      }

      const isAllowed = allowedUsers.includes(userData.userId)

      // Cache the result
      Cache.set("user_check", {
        userId: userData.userId,
        allowed: isAllowed,
        allowedUsers: allowedUsers,
      })

      // 🚨 FORCE LOGOUT IF NOT AUTHORIZED
      if (!isAllowed) {
        if (CONFIG.DEBUG) {
          console.log(`❌ User ${userData.userId} (${userData.userName}) not authorized`)
        }
        forceLogout()
        return { allowed: false, allowedUsers: null, userData: null }
      }

      if (CONFIG.DEBUG) {
        console.log(`✅ User ${userData.userId} (${userData.userName}) authorized`)
      }

      return { allowed: true, allowedUsers: allowedUsers, userData: userData }
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.error("❌ User verification failed:", error)
      }
      forceLogout()
      return { allowed: false, allowedUsers: null, userData: null }
    }
  }

  // 📥 Load main code
  async function loadMainCode() {
    try {
      let mainCode = Cache.get("main_code")

      if (!mainCode) {
        mainCode = await fetchRemote(CONFIG.MAIN_CODE_URL)

        if (!mainCode.includes("function") && !mainCode.includes("=>")) {
          throw new Error("Invalid code received")
        }

        Cache.set("main_code", mainCode)
      }

      return mainCode
    } catch (error) {
      throw error
    }
  }

  // 🚀 Execute the main code with proper GM function binding
  function executeMainCode(code, allowedUsers, userData) {
    try {
      // Set global variables that the main script expects
      window.lssTrackerAllowedUsers = allowedUsers
      window.lssTrackerUserData = userData

      // Create GM function wrappers that work in the executed context
      window.lssTrackerGM = {
        setValue: GM_setValue,
        getValue: GM_getValue,
        deleteValue: GM_deleteValue,
        xmlhttpRequest: GM_xmlhttpRequest,
        notification: GM_notification,
        addStyle: GM_addStyle
      }

      // Remove userscript headers if present
      const cleanCode = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, "")

      // Replace GM_ function calls with our wrapper
      const wrappedCode = cleanCode
        .replace(/GM_setValue/g, 'window.lssTrackerGM.setValue')
        .replace(/GM_getValue/g, 'window.lssTrackerGM.getValue')
        .replace(/GM_deleteValue/g, 'window.lssTrackerGM.deleteValue')
        .replace(/GM_xmlhttpRequest/g, 'window.lssTrackerGM.xmlhttpRequest')
        .replace(/GM_notification/g, 'window.lssTrackerGM.notification')
        .replace(/GM_addStyle/g, 'window.lssTrackerGM.addStyle')

      // Execute the code using eval (safer in this controlled context)
      eval(wrappedCode)

      // Show success notification
      GM_notification({
        text: `LSSTracker erfolgreich geladen für ${userData.userName}`,
        title: "LSSTracker",
        timeout: 3000,
      })

      if (CONFIG.DEBUG) {
        console.log("✅ LSSTracker main code executed successfully")
      }
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.error("❌ Code execution failed:", error)
      }
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
      // Only run on main pages
      if (!isMainPage()) return

      // Show loading notification
      if (CONFIG.DEBUG) {
        GM_notification({
          text: "LSSTracker wird geladen...",
          title: "LSSTracker",
          timeout: 2000,
        })
      }

      // Verify user access with profile data
      const accessResult = await verifyUserAccess()
      if (!accessResult.allowed) {
        return
      }

      // Load and execute main code
      const mainCode = await loadMainCode()
      executeMainCode(mainCode, accessResult.allowedUsers, accessResult.userData)

      if (CONFIG.DEBUG) {
        console.log("✅ LSSTracker loaded successfully")
      }
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.error("❌ LSSTracker loader failed:", error)
      }
      GM_notification({
        text: "LSSTracker konnte nicht geladen werden",
        title: "LSSTracker - Fehler",
        timeout: 5000,
      })
    }
  }

  // 🔄 Wait for page readiness
  function startLoader() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize)
    } else {
      setTimeout(initialize, 1500)
    }
  }

  // 🎬 Start the loader
  startLoader()
})()
