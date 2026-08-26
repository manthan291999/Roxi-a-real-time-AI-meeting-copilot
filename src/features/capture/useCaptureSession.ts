import { useState, useCallback, useContext } from 'react'
import { ServicesContext } from '../../context/ServicesContext'
import { Status } from '../../types'

export function useCaptureSession(
  setStatus: React.Dispatch<React.SetStateAction<Status>>,
  resetSpeakers: () => void,
  clearData: () => void,
  setPartialId: (id: string | null) => void
) {
  const [isCapturing, setIsCapturing] = useState(false)
  const services = useContext(ServicesContext)

  const handleStartCapture = useCallback(async (ctx: string) => {
    try {
      resetSpeakers()
      setPartialId(null)
      clearData()
      setStatus('connecting')
      setIsCapturing(true)

      await services?.captureService.startCapture(ctx)
    } catch (err) {
      console.error('Failed to start capture:', err)
      setStatus('unavailable')
      setIsCapturing(false)
    }
  }, [resetSpeakers, setPartialId, clearData, setStatus, services])

  const handleStopCapture = useCallback(async () => {
    try {
      await services?.captureService.stopCapture()
    } catch (err) {
      console.error('Failed to stop capture:', err)
    } finally {
      setPartialId(null)
      setIsCapturing(false)
      setStatus('idle')
    }
  }, [setPartialId, setStatus, services])

  return { isCapturing, handleStartCapture, handleStopCapture, setIsCapturing }
}
