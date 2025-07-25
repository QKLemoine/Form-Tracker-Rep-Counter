import cv2
import mediapipe as mp
import time

cap = cv2.VideoCapture(0) #which camera to use, 0 is default camera

mpHands = mp.solutions.hands
hands = mpHands.Hands()
mpDraw = mp.solutions.drawing_utils

pTime = 0
cTime = 0

while True:
    success, img = cap.read()
    imgRGB = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = hands.process(imgRGB)

    #print(results.multi_hand_landmarks) #prints the landmarks (x,y,z) of the detected hands

    if results.multi_hand_landmarks:
        for handLms in results.multi_hand_landmarks:
            for id, lm in enumerate(handLms.landmark): #enumerate gives index and landmark
                #print(id, lm) #prints the index and landmark coordinates
                h, w, c = img.shape #get height, width, and channels of the image
                cx, cy = int(lm.x * w), int(lm.y * h) #calculate the center of the landmark in pixel coordinates
                #print(id, cx, cy) #print the index and pixel coordinates
                if id == 0: #if the landmark is the wrist
                    cv2.circle(img, (cx, cy), 15, (255, 0, 255), cv2.FILLED) #draw a filled circle at the wrist landmark
                    
            mpDraw.draw_landmarks(img, handLms, mpHands.HAND_CONNECTIONS)# draw landmarks on the image
    
    cTime = time.time()
    fps = 1 / (cTime - pTime) #calculate frames per second
    pTime = cTime

    cv2.putText(img, str(int(fps)), (10, 70), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3) #display fps on the image

    cv2.imshow("Image", img)
    cv2.waitKey(1) #delay in milliseconds for camera feed