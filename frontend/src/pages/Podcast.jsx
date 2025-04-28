import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { saveContentToFirestore } from '../utils/firebaseHelpers';
import mammoth from 'mammoth';



const Podcast = () => {
  const [file, setFile] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [podcastStyle, setPodcastStyle] = useState('conversational');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [podcastContent, setPodcastContent] = useState('');
  const [podcastAudio, setPodcastAudio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const { currentUser } = useAuth();

  // Effect for handling job polling
  useEffect(() => {
    if (jobId && isPolling) {
      // Set up polling interval
      pollIntervalRef.current = setInterval(checkJobStatus, 3000);
      
      // Cleanup function
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [jobId, isPolling]);

  const checkJobStatus = async () => {
    if (!jobId) return;
    
    try {
      const response = await fetch(`http://localhost:3001/api/podcast-status/${jobId}`);
      
      if (!response.ok) {
        throw new Error(`Error checking status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.status === 'completed' && data.audioUrl) {
        // Job completed successfully
        clearInterval(pollIntervalRef.current);
        setIsPolling(false);
        setGenerationProgress(100);
        setAudioUrl(data.audioUrl);
        setStep(3);
        setIsGenerating(false);
        
        // Automatically play the audio if desired
        if (audioRef.current) {
          audioRef.current.play();
        }
      } else if (data.status === 'failed') {
        // Job failed
        clearInterval(pollIntervalRef.current);
        setIsPolling(false);
        setIsGenerating(false);
        setError(`Failed to generate podcast: ${data.message}`);
      } else {
        // Still processing - update progress indication 
        setGenerationProgress(prev => Math.min(prev + 5, 90));
      }
    } catch (err) {
      console.error('Error checking job status:', err);
      // Don't stop polling on temporary errors
      if (err.message.includes('404') || err.message.includes('not found')) {
        clearInterval(pollIntervalRef.current);
        setIsPolling(false);
        setIsGenerating(false);
        setError('Podcast generation job not found. Please try again.');
      }
    }
  };

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    
    if (!selectedFile) return;
    
    // Check file type
    const fileType = selectedFile.type;
    if (!fileType.includes('pdf') && 
        !fileType.includes('word') && 
        !fileType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      setError('Please upload a PDF or Word document (.pdf, .doc, .docx)');
      return;
    }
    
    setFile(selectedFile);
    setError('');
    setIsUploading(true);
    setUploadProgress(0);
    
    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);
    
    try {
      let text = '';
      
      // Extract text based on file type
      if (fileType.includes('pdf')) {
        // For PDF files - upload to server for extraction
        const formData = new FormData();
        formData.append('file', selectedFile);
        
        const response = await fetch(`http://localhost:3001/api/extract-pdf`, {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          throw new Error('Failed to extract text from PDF');
        }
        
        const data = await response.json();
        text = data.text;
      } else {
        // For Word documents - extract in the browser
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          try {
            const arrayBuffer = event.target.result;
            const result = await mammoth.extractRawText({ arrayBuffer });
            text = result.value;
            
            setExtractedText(text);
            clearInterval(progressInterval);
            setUploadProgress(100);
            setIsUploading(false);
            setStep(2);
          } catch (err) {
            clearInterval(progressInterval);
            setIsUploading(false);
            setError(`Failed to extract text: ${err.message}`);
          }
        };
        
        reader.readAsArrayBuffer(selectedFile);
        return; // Exit early for Word docs to allow async reader to work
      }
      
      setExtractedText(text);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setIsUploading(false);
      setStep(2);
    } catch (err) {
      clearInterval(progressInterval);
      setIsUploading(false);
      setError(`Error processing file: ${err.message}`);
    }
  };
  // Inside your React frontend file
  const generatePodcast = async () => {
    if (!extractedText.trim()) {
      setError('No text extracted from the document.');
      return;
    }
  
    // Start the generation process and set the initial progress
    setIsGenerating(true);
    setError('');
    setAudioUrl(null);
    setGenerationProgress(10);
    setStep(2); // Move to step 2: Generating Podcast
  
    try {
      // 1. Generate podcast content (optional if you have extra AI optimization)
      const contentResponse = await fetch('http://localhost:3001/api/generate-podcast-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: extractedText, 
          style: podcastStyle
        }),
      });
  
      if (!contentResponse.ok) {
        throw new Error('Failed to generate podcast content.');
      }
  
      const contentData = await contentResponse.json();
      const podcastText = contentData.podcastContent;
  
      setGenerationProgress(40); // Update progress
      setStep(2); // Remain at step 2 during podcast content generation
  
      // 2. Generate audio
      const response = await fetch('http://localhost:3001/api/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: podcastText }),
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        const message = errorData.message || 'Failed to generate audio.';
        throw new Error(message);
      }
  
      const data = await response.json();
  
      if (data.filename) {
        const audioUrl = `http://localhost:3001/api/podcast-audio?filename=${data.filename}`;
        setAudioUrl(audioUrl);
        setGenerationProgress(100); // Complete progress
        setStep(3); // Move to step 3: Listen to Podcast
      } else {
        throw new Error('No filename returned from server.');
      }
  
      setIsGenerating(false); // Generation finished
    } catch (err) {
      console.error('Error generating podcast:', err);
  
      let userErrorMessage = err.message;
      if (err.message.includes('401')) {
        userErrorMessage = 'Authentication failed. Please check the API key.';
      } else if (err.message.includes('429')) {
        userErrorMessage = 'Too many requests. Try again later.';
      } else if (err.message.includes('Failed to fetch')) {
        userErrorMessage = 'Cannot connect to server. Check connection.';
      }
  
      setError(userErrorMessage);
      setIsGenerating(false);
      setIsPolling(false);
  
      // Stop any polling if active
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    }
  };
  

  // Function to generate simplified podcast
  const generateSimplePodcast = async () => {
    if (!topic.trim()) {
      setError('Please enter a topic for your podcast');
      return;
    }
    
    if (!title.trim()) {
      setError('Please provide a title for your podcast');
      return;
    }
  
    setLoading(true);
    setError('');
    setSaved(false);
    setPodcastContent('');
    setPodcastAudio(null);
  
    try {
      // Call the backend API to generate podcast content
      const response = await axios.post(`http://localhost:3001/api/generate-podcast`, {
        text: topic,
        style: 'educational',
      });
  
      if (response.data.podcastContent) {
        setPodcastContent(response.data.podcastContent);
        
        // Save to Firebase if user is logged in
        if (currentUser) {
          try {
            await saveContentToFirestore(
              currentUser.uid,
              title,
              response.data.podcastContent,
              'podcast'
            );
            setSaved(true);
          } catch (error) {
            console.error('Error saving podcast:', error);
          }
        }
      } else if (response.data.error) {
        throw new Error(response.data.error);
      }
    } catch (err) {
      setError(`Error generating podcast: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetProcess = () => {
    setFile(null);
    setExtractedText('');
    setAudioUrl(null);
    setError('');
    setStep(1);
    setUploadProgress(0);
    setGenerationProgress(0);
    setJobId(null);
    setIsPolling(false);
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  return (
    <div className="max-w-4xl mx-auto p-6 bg-gradient-to-b from-white to-indigo-50 shadow-xl rounded-xl my-12">
      <h1 className="text-3xl font-bold text-center text-indigo-800 mb-8">PodCast Studio</h1>
      
      {/* Steps Progress */}
      <div className="mb-10 px-4">
        <div className="flex items-center justify-between">
          {['Upload', 'Generate', 'Listen'].map((label, index) => (
            <div key={label} className={`flex flex-col items-center ${step >= index + 1 ? 'text-indigo-600' : 'text-gray-400'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step >= index + 1 ? 'bg-indigo-100 text-indigo-600 border-2 border-indigo-600' : 'bg-gray-200 text-gray-400'}`}>
                {index + 1}
              </div>
              <span className="mt-2 text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Errors */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-md">
          <div className="flex">
            <svg className="h-5 w-5 text-red-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p>{error}</p>
          </div>
        </div>
      )}
      
      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="mb-8">
          <div className="border-2 border-dashed border-indigo-300 rounded-lg p-8 text-center bg-indigo-50 hover:bg-indigo-100 transition-colors">
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileChange} 
              className="hidden" 
              accept=".pdf,.doc,.docx"
              disabled={isUploading}
            />
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="w-24 h-24 bg-indigo-600 rounded-full flex items-center justify-center text-white">
                <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-800">Upload Your Document</h3>
              <p className="text-gray-600 max-w-sm">Upload a Word or PDF document to transform into a professional podcast with multiple voices</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 transition shadow-md"
                disabled={isUploading}
              >
                {isUploading ? 'Uploading...' : 'Select Document'}
              </button>
              <p className="text-xs text-gray-500">Supported formats: .pdf, .doc, .docx</p>
            </div>
            {isUploading && (
              <div className="mt-4">
                <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-600 mt-2">{uploadProgress < 100 ? 'Processing document...' : 'Text extraction complete!'}</p>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Step 2: Generate */}
      {step === 2 && (
        <div className="mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-md">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Document Content</h3>
            {file && (
              <div className="mb-4 flex items-center bg-indigo-50 p-3 rounded-lg">
                <svg className="h-8 w-8 text-indigo-500 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div>
                  <p className="font-medium text-gray-800">{file.name}</p>
                  <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            )}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Podcast Style</label>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {['Conversational', 'Educational', 'Storytelling', 'Interview'].map((style) => (
                  <div 
                    key={style}
                    onClick={() => setPodcastStyle(style)}
                    className={`cursor-pointer rounded-lg border p-3 ${podcastStyle === style ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                  >
                    <div className="flex justify-between">
                      <h4 className="font-medium text-gray-900">{style}</h4>
                      {podcastStyle === style && (
                        <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <h4 className="text-gray-700 mb-4">Extracted Text</h4>
            <textarea 
              value={extractedText} 
              rows={6} 
              readOnly 
              className="w-full p-3 border border-gray-200 rounded-lg mb-6 bg-gray-50"
            />
            <div className="flex justify-between items-center">
              <button
                onClick={resetProcess}
                className="px-6 py-3 bg-gray-400 text-white font-medium rounded-lg hover:bg-gray-500"
              >
                Back
              </button>
              <button
                onClick={generatePodcast}
                disabled={isGenerating || !podcastStyle}
                className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-400"
              >
                {isGenerating ? 'Generating...' : 'Generate Podcast'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Step 3: Listen */}
      {step === 3 && (
        <div className="mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-md">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Your Generated Podcast</h3>
            {audioUrl ? (
              <audio controls className="w-full">
                <source src={audioUrl} type="audio/mp3" />
                Your browser does not support the audio element.
              </audio>
            ) : (
              <p>Podcast is being generated, please wait...</p>
            )}
          </div>
        </div>
      )}
    </div>
 
  );
};

export default Podcast;
