'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Globe,
  Loader2,
  Send,
  Code,
  Eye,
  RefreshCw,
  Upload,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { getApiKeys, getWordPressConfig } from '@/lib/storage'

// Monaco Editorは動的インポート（SSR無効）
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── Diff highlight helper ─────────────────────────────────────────────────

function DiffBlock({ original, modified }: { original: string; modified: string }) {
  const origLines = original.split('\n')
  const modLines = modified.split('\n')
  const maxLen = Math.max(origLines.length, modLines.length)

  const rows: { type: 'removed' | 'added' | 'unchanged'; text: string }[] = []
  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i]
    const m = modLines[i]
    if (o === undefined) {
      rows.push({ type: 'added', text: m })
    } else if (m === undefined) {
      rows.push({ type: 'removed', text: o })
    } else if (o !== m) {
      rows.push({ type: 'removed', text: o })
      rows.push({ type: 'added', text: m })
    } else {
      rows.push({ type: 'unchanged', text: o })
    }
  }

  return (
    <pre className="text-xs font-mono overflow-auto rounded-md bg-slate-900 p-3 text-slate-100 max-h-64">
      {rows.map((row, idx) => (
        <div
          key={idx}
          className={
            row.type === 'removed'
              ? 'bg-red-900/50 text-red-300'
              : row.type === 'added'
              ? 'bg-green-900/50 text-green-300'
              : ''
          }
        >
          {row.type === 'removed' ? '- ' : row.type === 'added' ? '+ ' : '  '}
          {row.text}
        </div>
      ))}
    </pre>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function WebsitePage() {
  const [url, setUrl] = useState('')
  const [htmlCode, setHtmlCode] = useState('')
  const [originalHtml, setOriginalHtml] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewTab, setPreviewTab] = useState<'preview' | 'editor'>('preview')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [userInput, setUserInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [pendingCode, setPendingCode] = useState<string | null>(null)

  const [wpUploading, setWpUploading] = useState(false)
  const [wpResult, setWpResult] = useState<{ ok: boolean; message: string } | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)

  const wpConfig = getWordPressConfig()
  const apiKeys = getApiKeys()

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Update iframe preview when html changes
  useEffect(() => {
    setPreviewHtml(htmlCode)
  }, [htmlCode])

  // ── Scrape ───────────────────────────────────────────────────────────────

  const handleScrape = async () => {
    if (!url.trim()) return
    setScraping(true)
    setScrapeError(null)
    setPendingCode(null)
    setMessages([])
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error('スクレイピングに失敗しました')
      const data = await res.json()
      const html: string = data.html ?? data.content ?? ''
      setHtmlCode(html)
      setOriginalHtml(html)
      setPreviewHtml(html)
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setScraping(false)
    }
  }

  // ── AI Chat ──────────────────────────────────────────────────────────────

  const handleSendMessage = async () => {
    if (!userInput.trim() || aiLoading) return
    if (!apiKeys.anthropic) {
      alert('Anthropic APIキーが必要です（設定から入力してください）')
      return
    }

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: userInput },
    ]
    setMessages(newMessages)
    setUserInput('')
    setAiLoading(true)
    setPendingCode(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: `あなたはGEO（Generative Engine Optimization）の専門家です。
ユーザーが提供するHTML/CSSコードをGEO観点から改善する提案を行ってください。
改善コードを提案する場合は、必ず以下の形式でコードブロックを含めてください：

\`\`\`html
[改善されたHTMLコード全文]
\`\`\`

現在のHTMLコード:
${htmlCode}

改善の観点:
- 構造化データ（Schema.org）の追加・改善
- メタタグ・OGPの最適化
- コンテンツの明確化・FAQ追加
- 見出し構造の改善
- E-E-A-T要素の強化`,
          apiKey: apiKeys.anthropic,
        }),
      })
      if (!res.ok) throw new Error('AIの応答取得に失敗しました')
      const data = await res.json()
      const assistantMessage = data.content ?? data.message ?? ''

      // Extract code block if present
      const codeMatch = assistantMessage.match(/```html\n([\s\S]*?)```/)
      if (codeMatch) {
        setPendingCode(codeMatch[1])
      }

      setMessages([...newMessages, { role: 'assistant', content: assistantMessage }])
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `エラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}` },
      ])
    } finally {
      setAiLoading(false)
    }
  }

  // ── Apply pending code ────────────────────────────────────────────────────

  const handleApplyCode = () => {
    if (!pendingCode) return
    setHtmlCode(pendingCode)
    setPreviewHtml(pendingCode)
    setPendingCode(null)
    setPreviewTab('preview')
  }

  // ── WordPress upload ──────────────────────────────────────────────────────

  const handleWordPressUpdate = async () => {
    if (!wpConfig.siteUrl || !wpConfig.username || !wpConfig.applicationPassword) {
      setWpResult({ ok: false, message: 'WordPress設定が完了していません（設定ページで入力してください）' })
      return
    }
    setWpUploading(true)
    setWpResult(null)
    try {
      const base64 = btoa(`${wpConfig.username}:${wpConfig.applicationPassword}`)
      const siteUrl = wpConfig.siteUrl.replace(/\/$/, '')

      // Get existing pages to find target page by URL
      const pagesRes = await fetch(`${siteUrl}/wp-json/wp/v2/pages?search=${encodeURIComponent(url)}&per_page=5`, {
        headers: { Authorization: `Basic ${base64}` },
      })
      if (!pagesRes.ok) throw new Error(`WordPress API エラー: HTTP ${pagesRes.status}`)
      const pages = await pagesRes.json()

      if (pages.length === 0) {
        setWpResult({ ok: false, message: 'URLに一致するWordPressページが見つかりませんでした' })
        return
      }

      const page = pages[0]
      const updateRes = await fetch(`${siteUrl}/wp-json/wp/v2/pages/${page.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${base64}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: { raw: htmlCode } }),
      })
      if (!updateRes.ok) throw new Error(`更新失敗: HTTP ${updateRes.status}`)
      setWpResult({ ok: true, message: `「${page.title.rendered}」を更新しました` })
    } catch (err) {
      setWpResult({ ok: false, message: err instanceof Error ? err.message : '更新に失敗しました' })
    } finally {
      setWpUploading(false)
    }
  }

  const hasHtml = htmlCode.length > 0

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-0">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background shrink-0">
        <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
        <h1 className="font-semibold text-sm mr-2 shrink-0">ウェブサイト改善</h1>
        <div className="flex flex-1 gap-2 max-w-2xl">
          <Input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !scraping) handleScrape() }}
            className="h-8 text-sm"
          />
          <Button size="sm" onClick={handleScrape} disabled={scraping || !url.trim()} className="shrink-0">
            {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">{scraping ? '取得中...' : '取得'}</span>
          </Button>
        </div>
        {wpConfig.connected && hasHtml && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleWordPressUpdate}
            disabled={wpUploading}
            className="shrink-0 ml-auto"
          >
            {wpUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
            WordPress更新
          </Button>
        )}
      </div>

      {scrapeError && (
        <Alert variant="destructive" className="mx-4 mt-2 shrink-0">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{scrapeError}</AlertDescription>
        </Alert>
      )}
      {wpResult && (
        <Alert className={`mx-4 mt-2 shrink-0 ${wpResult.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {wpResult.ok ? <CheckCircle className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
          <AlertDescription className={wpResult.ok ? 'text-green-700' : 'text-red-700'}>{wpResult.message}</AlertDescription>
        </Alert>
      )}

      {/* Main split panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Preview + Editor tabs */}
        <div className="flex flex-col w-1/2 border-r overflow-hidden">
          <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as 'preview' | 'editor')} className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="mx-3 mt-2 mb-0 shrink-0 self-start">
              <TabsTrigger value="preview" className="text-xs gap-1">
                <Eye className="h-3.5 w-3.5" />プレビュー
              </TabsTrigger>
              <TabsTrigger value="editor" className="text-xs gap-1">
                <Code className="h-3.5 w-3.5" />コードエディタ
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="flex-1 overflow-hidden m-0 mt-2">
              {hasHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-full border-0"
                  sandbox="allow-same-origin allow-scripts"
                  title="Preview"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                  <div className="text-center">
                    <Globe className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>URLを入力して「取得」を押すとプレビューが表示されます</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="editor" className="flex-1 overflow-hidden m-0 mt-2">
              <MonacoEditor
                height="100%"
                language="html"
                value={htmlCode}
                onChange={(v) => setHtmlCode(v ?? '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: AI Chat */}
        <div className="flex flex-col w-1/2 overflow-hidden">
          <div className="px-3 py-2 border-b shrink-0 flex items-center gap-2">
            <span className="text-sm font-medium">AIアシスタント</span>
            <Badge variant="secondary" className="text-xs">GEO改善</Badge>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                <p className="font-medium mb-1">AIにGEO改善を依頼できます</p>
                <p className="text-xs">例: 「Schema.orgの構造化データを追加してください」</p>
                <p className="text-xs mt-1">「FAQセクションを追加してGEO最適化してください」</p>
                <p className="text-xs mt-1">「E-E-A-T向上のためのコンテンツ改善提案をください」</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {aiLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  考え中...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Pending code diff */}
          {pendingCode && (
            <div className="px-3 py-2 border-t border-b bg-slate-50 space-y-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">AIが提案するコード変更</span>
                <Button size="sm" onClick={handleApplyCode} className="h-7 text-xs">
                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  適用する
                </Button>
              </div>
              <DiffBlock original={originalHtml} modified={pendingCode} />
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t shrink-0">
            <div className="flex gap-2">
              <Textarea
                placeholder={hasHtml ? 'GEO改善の指示を入力（例: 構造化データを追加して）' : 'まずURLを取得してください'}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                disabled={!hasHtml || aiLoading}
                rows={3}
                className="resize-none text-sm"
              />
              <Button
                size="sm"
                onClick={handleSendMessage}
                disabled={!hasHtml || !userInput.trim() || aiLoading}
                className="shrink-0 self-end"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Enterで送信 / Shift+Enterで改行</p>
          </div>
        </div>
      </div>
    </div>
  )
}
