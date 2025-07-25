import cv2
import mediapipe as mp
import time

class handDetector():
    def __init__(self, mode=False, maxHands=2, modelComplexity = 1, detectionCon=0.5, trackCon=0.5):
        self.mode = mode
        self.maxHands = maxHands
        self.modelComplexity = modelComplexity
        self.detectionCon = detectionCon
        self.trackCon = trackCon

        self.mpHands = mp.solutions.hands
        self.hands = self.mpHands.Hands(self.mode, self.maxHands, self.modelComplexity, self.detectionCon, self.trackCon)
        self.mpDraw = mp.solutions.drawing_utils


    def findHands(self, img, draw=True):
        imgRGB = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        results = self.hands.process(imgRGB)
        #print(results.multi_hand_landmarks) #prints the landmarks (x,y,z) of the detected hands

        if results.multi_hand_landmarks:
            for handLms in results.multi_hand_landmarks:
                if draw:
                    self.mpDraw.draw_landmarks(img, handLms, self.mpHands.HAND_CONNECTIONS)  # draw landmarks on the image        

        return img
    
                # for id, lm in enumerate(handLms.landmark): #enumerate gives index and landmark
                # #print(id, lm) #prints the index and landmark coordinates
                # h, w, c = img.shape #get height, width, and channels of the image
                # cx, cy = int(lm.x * w), int(lm.y * h) #calculate the center of the landmark in pixel coordinates
                # #print(id, cx, cy) #print the index and pixel coordinates
                # if id == 0: #if the landmark is the wrist
                #     cv2.circle(img, (cx, cy), 15, (255, 0, 255), cv2.FILLED) #draw a filled circle at the wrist landmark
    


def main():
    pTime = 0
    cTime = 0

    cap = cv2.VideoCapture(0) #which camera to use, 0 is default camera

    detector = handDetector()
    while True:
        success, img = cap.read()
        img = detector.findHands(img)

        cTime = time.time()
        fps = 1 / (cTime - pTime) #calculate frames per second
        pTime = cTime

        cv2.putText(img, str(int(fps)), (10, 70), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3) #display fps on the image

        cv2.imshow("Image", img)
        cv2.waitKey(1) #delay in milliseconds for camera feed




if __name__ == "__main__":
    main()