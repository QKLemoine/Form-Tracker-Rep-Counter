import cv2
import mediapipe as mp
import time
import HandTrackingModule as htm

pTime = 0
cTime = 0

cap = cv2.VideoCapture(0) #which camera to use, 0 is default camera

detector = htm.handDetector()
while True:
    success, img = cap.read()
    img = detector.findHands(img)
    lmList = detector.findPosition(img, draw=False)
    if len(lmList) != 0:
        print(lmList[4])  # print the list of landmark positions

    cTime = time.time()
    fps = 1 / (cTime - pTime) #calculate frames per second
    pTime = cTime

    cv2.putText(img, str(int(fps)), (10, 70), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3) #display fps on the image

    cv2.imshow("Image", img)
    cv2.waitKey(1) #delay in milliseconds for camera feed