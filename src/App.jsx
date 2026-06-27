import { useState, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { Analytics } from "@vercel/analytics/react"
import './index.css'

// Initialize PDF.js worker using a more robust method for Vite
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

function App() {
  const [resume, setResume] = useState('')
  const [jobDesc, setJobDesc] = useState('')
  const [results, setResults] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const fileInputRef = useRef(null)

  const extractTextFromPDF = async (arrayBuffer) => {
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: true,
        isEvalSupported: false
      })
      const pdf = await loadingTask.promise
      let fullText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map(item => item.str).join(' ')
        fullText += pageText + '\n'
      }
      return fullText
    } catch (err) {
      console.error('PDF extraction failed:', err)
      throw new Error('PDF extraction failed: ' + err.message)
    }
  }

  const extractTextFromDocx = async (arrayBuffer) => {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer })
      return result.value
    } catch (err) {
      console.error('Word extraction failed:', err)
      throw new Error('Word extraction failed: ' + err.message)
    }
  }

  const extractTextFromPptx = async (arrayBuffer) => {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer)
      let fullText = ''

      const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))

      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0])
        const numB = parseInt(b.match(/\d+/)[0])
        return numA - numB
      })

      for (const slideFile of slideFiles) {
        const content = await zip.file(slideFile).async('text')
        const textMatches = content.match(/<a:t>([^<]+)<\/a:t>/g)
        if (textMatches) {
          const slideText = textMatches.map(m => m.replace(/<\/?a:t>/g, '')).join(' ')
          fullText += slideText + '\n'
        }
      }
      return fullText
    } catch (err) {
      console.error('PPTX extraction failed:', err)
      throw new Error('PPTX extraction failed: ' + err.message)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIsExtracting(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      let extractedText = ''

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        extractedText = await extractTextFromPDF(arrayBuffer)
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
        extractedText = await extractTextFromDocx(arrayBuffer)
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || file.name.endsWith('.pptx')) {
        extractedText = await extractTextFromPptx(arrayBuffer)
      } else {
        throw new Error('Unsupported file format. Please upload PDF, DOCX, or PPTX.')
      }

      if (!extractedText.trim()) {
        throw new Error('No text content could be extracted from this file.')
      }

      setResume(extractedText)
    } catch (error) {
      console.error('File processing error:', error)
      alert(error.message)
    } finally {
      setIsExtracting(false)
      // Reset file input so same file can be uploaded again
      e.target.value = ''
    }
  }

  const analyzeMatch = async () => {
    if (!resume || !jobDesc) {
      alert('Please provide both resume and job description')
      return
    }

    setIsAnalyzing(true)

    const prompt = `
      Analyze the following Resume against the Job Description.
      
      Resume:
      ${resume}

      Job Description:
      ${jobDesc}

      Return a JSON object with:
      {
        "score": number (0-100),
        "missingSkills": ["skill 1", "skill 2", ...],
        "suggestions": ["suggestion 1", "suggestion 2", ...]
      }
      ONLY return the JSON object. No other text.
    `

    try {
      // NOTE: For a real production app, use a backend to hide your API key.
      const API_KEY = process.env.MISTRAL_API_KEY
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: 'open-mistral-7b',
          messages: [
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Mistral API Error')
      }

      const data = await response.json()
      const analysis = JSON.parse(data.choices[0].message.content)

      setResults({
        score: analysis.score || 0,
        missingSkills: analysis.missingSkills || ['No specific skills identified.'],
        suggestions: analysis.suggestions || ['Ensure your resume is well-formatted.']
      })
    } catch (error) {
      console.error('AI Analysis error:', error)
      alert('AI Analysis failed: ' + error.message + '\n\nFalling back to keyword matching...')

      // Heuristic Fallback
      const resumeWords = resume.toLowerCase().split(/\W+/).filter(w => w.length > 3)
      const jobWords = jobDesc.toLowerCase().split(/\W+/).filter(w => w.length > 3)
      const jobSet = new Set(jobWords)
      const resumeSet = new Set(resumeWords)
      const common = [...jobSet].filter(word => resumeSet.has(word))
      const matchScore = Math.min(100, Math.round((common.length / jobSet.size) * 150))

      setResults({
        score: matchScore,
        missingSkills: ['Cloud AI (Mistral) request failed. These results are based on simple keyword matching.'],
        suggestions: ['Check your internet connection and API key quota.']
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Resume Matcher</h1>
        <p className="subtitle">Optimize your resume (Text, PDF, Word, or PPT)</p>
      </header>

      <main>
        <div className="editor-grid">
          <div className="editor-group">
            <div className="label-row">
              <label htmlFor="resume">Resume</label>
              <button
                className="upload-link"
                onClick={() => fileInputRef.current.click()}
                disabled={isExtracting}
              >
                {isExtracting ? 'Extracting...' : 'Upload File (PDF/DOCX/PPTX)'}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".pdf,.docx,.pptx"
                onChange={handleFileUpload}
              />
            </div>
            <textarea
              id="resume"
              placeholder="Paste your resume text here or upload a file..."
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            />
          </div>
          <div className="editor-group">
            <label htmlFor="jobDesc">Job Description</label>
            <textarea
              id="jobDesc"
              placeholder="Paste the job description here..."
              value={jobDesc}
              onChange={(e) => setJobDesc(e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button
            className="check-btn"
            onClick={analyzeMatch}
            disabled={isAnalyzing || isExtracting}
          >
            {isAnalyzing ? 'Analyzing...' : 'Check Match'}
          </button>
        </div>

        {results && (
          <section className="results-section">
            <div className="results-grid">
              <div className="score-container">
                <div className="percentage-circle">
                  <svg width="150" height="150">
                    <circle className="circle-bg" cx="75" cy="75" r="65" />
                    <circle
                      className="circle-fill"
                      cx="75"
                      cy="75"
                      r="65"
                      strokeDasharray="408.4"
                      strokeDashoffset={408.4 - (408.4 * results.score) / 100}
                    />
                  </svg>
                  <div className="percentage-text">{results.score}%</div>
                </div>
                <label>Match Percentage</label>
              </div>

              <div className="details-group">
                <div className="detail-item">
                  <h3>Missing Skills</h3>
                  <ul>
                    {results.missingSkills.map((skill, idx) => (
                      <li key={idx}>{skill}</li>
                    ))}
                  </ul>
                </div>
                <div className="detail-item">
                  <h3>Suggestions</h3>
                  <ul>
                    {results.suggestions.map((sug, idx) => (
                      <li key={idx}>{sug}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <p>Created by <strong>Vaishnavan S</strong></p>
        <div className="social-symbols">
          <a href="https://github.com/vaishnavanS" target="_blank" rel="noopener noreferrer" className="symbol-link github" title="GitHub">
            <svg viewBox="0 0 24 24" className="symbol-svg">
              <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
            </svg>
          </a>
          <a href="https://www.linkedin.com/in/vaishnavan10" target="_blank" rel="noopener noreferrer" className="symbol-link linkedin" title="LinkedIn">
            <svg viewBox="0 0 24 24" className="symbol-svg">
              <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
              <circle cx="4" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </a>
          <a href="mailto:vaishnavans31@gmail.com" className="symbol-link gmail" title="Contact Me">
            <svg viewBox="0 0 24 24" className="symbol-svg">
              <rect width="18" height="14" x="3" y="5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="m3 7 9 6 9-6" />
            </svg>
          </a>
        </div>
      </footer>
      <Analytics />
    </div>
  )
}

export default App
