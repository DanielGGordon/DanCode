import Terminal from './Terminal.jsx'

function App() {
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
