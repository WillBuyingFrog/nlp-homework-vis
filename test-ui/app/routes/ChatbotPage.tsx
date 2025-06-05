import React, { useState, useEffect, useRef } from 'react';

const BACKEND_URL = 'http://localhost:5001'; // Flask backend URL
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com";

// Frontend's internal state representation
type FrontendAnalysisStatus = 'idle' | 'loading' | 'success' | 'error' | 'processing';

// Type for status messages received from backend
type BackendTaskActualStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface TaskStatusResponse {
  task_id: string;
  status: BackendTaskActualStatus; // Correctly typed based on what backend sends
  message: string;
  html_url?: string;
  error_details?: string;
}

export default function ChatbotPage() {
  const [analysisStatus, setAnalysisStatus] = useState<FrontendAnalysisStatus>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [analysisResultUrl, setAnalysisResultUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('点击按钮开始分析文档。');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Chat state (placeholders for now) ---
  const [chatMessages, setChatMessages] = useState<{ sender: string, text: string }[]>([]);
  const [userInput, setUserInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleStartAnalysis = async () => {
    setAnalysisStatus('loading');
    setStatusMessage('正在请求开始分析...');
    setErrorMessage(null);
    setAnalysisResultUrl(null); // Clear previous results

    console.log("Starting analysis...");

    try {
      const response = await fetch(`${BACKEND_URL}/api/start-dummy-analysis`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTaskId(data.task_id);
      setAnalysisStatus('processing');
      setStatusMessage('分析任务已启动，正在处理中...');
    } catch (error) {
      console.error("Error starting analysis:", error);
      setAnalysisStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '启动分析失败，请检查后端服务。');
      setStatusMessage('分析启动失败。');
    }
  };

  useEffect(() => {
    if (taskId && (analysisStatus === 'processing' || analysisStatus === 'loading')) {
      const intervalId = setInterval(async () => {
        try {
          const response = await fetch(`${BACKEND_URL}/api/analysis-status/${taskId}`);
          if (!response.ok) {
            // If task ID is not found (404), it might mean backend restarted or task expired
            // Or a genuine server error
            if (response.status === 404) {
                throw new Error(`任务ID ${taskId} 未找到。可能已过期或后端服务已重启。`);
            }
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
          }
          const data: TaskStatusResponse = await response.json();
          
          setStatusMessage(data.message || '正在获取状态...');

          if (data.status === 'completed') {
            setAnalysisStatus('success');
            setAnalysisResultUrl(data.html_url ? `${BACKEND_URL}${data.html_url}` : null);
            setStatusMessage(data.message || '分析成功完成！');
            setTaskId(null); // Clear task ID as it's done
            clearInterval(intervalId);
          } else if (data.status === 'failed') {
            setAnalysisStatus('error');
            setErrorMessage(data.error_details || data.message || '分析过程中发生未知错误。');
            setStatusMessage(data.message || '分析失败。');
            setTaskId(null); // Clear task ID
            clearInterval(intervalId);
          } else if (data.status === 'processing') {
            setAnalysisStatus('processing');
          } else if (data.status === 'pending') {
            setAnalysisStatus('processing');
            setStatusMessage(data.message || '任务正在等待执行...');
          }
        } catch (error) {
          console.error("Error fetching analysis status:", error);
          setAnalysisStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '获取分析状态失败。');
          setStatusMessage('获取分析状态时出错。');
          setTaskId(null);
          clearInterval(intervalId);
        }
      }, 3000); // Poll every 3 seconds

      return () => clearInterval(intervalId);
    }
  }, [taskId, analysisStatus]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    const newUserMessage = { sender: 'user', text: userInput };
    setChatMessages(prevMessages => [...prevMessages, newUserMessage]);
    const currentInput = userInput;
    setUserInput('');
    setStatusMessage('正在发送消息至大模型...');

    try {
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: currentInput, context: analysisResultUrl /* or other context */ }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.reply || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const botMessage = { sender: 'bot', text: data.reply };
        setChatMessages(prevMessages => [...prevMessages, botMessage]);
        setStatusMessage('大模型已回复。');
    } catch (error) {
        console.error("Error sending message:", error);
        const errorMessageText = error instanceof Error ? error.message : '与大模型通信失败。';
        setChatMessages(prevMessages => [...prevMessages, { sender: 'bot', text: `错误: ${errorMessageText}` }]);
        setStatusMessage('消息发送失败。');
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-theme-bg-light p-4 sm:p-6 lg:p-8 font-sans">
      <header className="mb-6 pb-4 border-b border-theme-blue-dark">
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-text mb-2 ">文档分析与问答机器人</h1>
        <p className={`text-sm ${analysisStatus === 'error' ? 'text-red-600' : 'text-theme-text/80'}`}>
          {statusMessage}
        </p>
        {analysisStatus === 'error' && errorMessage && (
          <p className="text-sm text-red-700 italic mt-1">错误详情: {errorMessage}</p>
        )}
      </header>

      <main className="flex-grow flex flex-col gap-6">
        {/* Analysis Control and Display */} 
        <section>
          {analysisStatus !== 'success' && (
              <button type='button'
                onClick={(e) => {
                  console.log('[[DEBUG]] Button onClick handler fired!');
                  handleStartAnalysis();
                }}
                disabled={analysisStatus === 'loading' || analysisStatus === 'processing'}
                className={`px-6 py-3 text-lg font-semibold rounded-md shadow-md transition-colors duration-150
                            ${(analysisStatus === 'loading' || analysisStatus === 'processing') 
                              ? 'bg-gray-400 cursor-not-allowed' 
                              : 'bg-blue-500 text-white hover:bg-theme-blue-light focus:ring-2 focus:ring-theme-blue-dark focus:ring-opacity-50'}
                          `}
              >
                {analysisStatus === 'loading' || analysisStatus === 'processing' ? '正在分析中...' : '开始分析文档'}
              </button>
          )}
        </section>

        {/* Analysis Result Display */} 
        {analysisStatus === 'success' && analysisResultUrl && (
          <section className="flex-grow flex flex-col bg-white shadow-lg rounded-lg overflow-hidden border border-theme-blue-dark/50">
            <h2 className="text-xl font-semibold text-theme-text p-4 bg-theme-blue/10 border-b border-theme-blue-dark/30">分析结果</h2>
            <iframe 
              src={analysisResultUrl} 
              title="分析结果" 
              className="w-full h-full flex-grow border-none"
            />
          </section>
        )}
        
        {/* Loading/Processing Indicator (could be more sophisticated) */} 
        {(analysisStatus === 'loading' || analysisStatus === 'processing') && !analysisResultUrl && (
            <div className="text-center py-10">
                <p className="text-theme-text text-xl">请稍候，文档正在分析中...</p>
                {/* Consider adding a spinner here */}
                <svg className="animate-spin h-8 w-8 text-theme-blue-DEFAULT mx-auto mt-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        )}

        {/* Chat Interface - Only show if analysis was successful */} 
        {analysisStatus === 'success' && (
          <section className="mt-auto bg-white/80 backdrop-blur-md p-4 rounded-lg shadow-md border border-theme-blue-dark/30 flex flex-col gap-3">
            <h3 className="text-lg font-semibold text-theme-text mb-2">与我对话：</h3>
            <div ref={chatContainerRef} className="flex-grow max-h-60 overflow-y-auto p-3 space-y-3 bg-theme-blue/5 rounded-md custom-scrollbar">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <span className={`inline-block py-2 px-4 rounded-xl shadow max-w-xs sm:max-w-md lg:max-w-lg break-words 
                                   ${msg.sender === 'user' ? 'bg-theme-blue text-white' : 'bg-gray-200 text-gray-800'}
                                 `}>
                    {msg.text}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input 
                type="text" 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="基于分析结果提问..." 
                className="flex-grow p-3 border border-theme-blue-dark/50 rounded-lg focus:ring-2 focus:ring-theme-blue-DEFAULT focus:border-transparent outline-none transition-shadow"
                disabled={analysisStatus !== 'success' || userInput === undefined} // Keep disabled state logic
              />
              <button 
                onClick={handleSendMessage}
                className={`px-6 py-3 font-semibold rounded-lg shadow-md transition-colors duration-150
                            ${(!userInput.trim() || analysisStatus !== 'success') 
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                              : 'bg-theme-blue-DEFAULT text-white hover:bg-theme-blue-light focus:ring-2 focus:ring-theme-blue-dark focus:ring-opacity-50'}
                          `}
                disabled={!userInput.trim() || analysisStatus !== 'success'}
              >
                发送
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
} 