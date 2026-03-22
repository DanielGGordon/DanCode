import { useState } from 'react'
import Terminal from './Terminal.jsx'
import LoginScreen from './LoginScreen.jsx'

const TOKEN_KEY = 'dancode-auth-token'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))

  function handleLogin(value) {
    localStorage.setItem(TOKEN_KEY, value)
    setToken(value)
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      <header className="flex items-center px-4 py-2 bg-base02 border-b border-base01/30">
        <h1 className="text-sm font-semibold text-base1 tracking-wide">DanCode</h1>
      </header>
      <main className="flex-1 min-h-0">
        <Terminal />
      </main>
    </div>
  )
}

export default App
